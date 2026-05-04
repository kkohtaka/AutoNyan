import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

export interface TerraformOutputs {
  drive_scan_trigger_topic: string;
  doc_process_trigger_topic: string;
  document_storage_bucket: string;
  vision_results_bucket: string;
  drive_folder_id: string;
  category_root_folder_id: string;
  uncategorized_folder_id: string;
  project_id: string;
  file_classifier_service_account_email: string;
}

interface TerraformOutput {
  value: string;
}

interface TerraformVariables {
  project_id?: string;
  drive_folder_id?: string;
  category_root_folder_id?: string;
  uncategorized_folder_id?: string;
}

let cachedOutputs: Record<string, TerraformOutputs> = {};
let cachedVariables: TerraformVariables | null = null;

/**
 * Parse Terraform variables from terraform.tfvars file
 *
 * @returns Parsed Terraform variables
 */
function parseTerraformVariables(): TerraformVariables {
  if (cachedVariables) {
    return cachedVariables;
  }

  const terraformDir = path.join(process.cwd(), 'terraform');
  const tfvarsPath = path.join(terraformDir, 'terraform.tfvars');

  if (!fs.existsSync(tfvarsPath)) {
    cachedVariables = {};
    return cachedVariables;
  }

  try {
    const content = fs.readFileSync(tfvarsPath, 'utf-8');
    const variables: TerraformVariables = {};

    // Parse simple key = "value" format
    const lines = content.split('\n');
    for (const line of lines) {
      const match = line.match(/^\s*(\w+)\s*=\s*"([^"]+)"/);
      if (match) {
        const [, key, value] = match;
        if (
          key === 'project_id' ||
          key === 'drive_folder_id' ||
          key === 'category_root_folder_id' ||
          key === 'uncategorized_folder_id'
        ) {
          variables[key] = value;
        }
      }
    }

    cachedVariables = variables;
    return variables;
  } catch (error) {
    console.warn('Failed to parse terraform.tfvars:', error);
    cachedVariables = {};
    return cachedVariables;
  }
}

/**
 * Get Terraform outputs for the specified environment
 *
 * @param environment - Environment name (default: 'staging')
 * @returns Terraform outputs for the environment
 */
export async function getTerraformOutputs(
  environment: string = 'staging'
): Promise<TerraformOutputs> {
  // Return cached outputs to avoid repeated Terraform calls
  if (cachedOutputs[environment]) {
    return cachedOutputs[environment];
  }

  const terraformDir = path.join(process.cwd(), 'terraform');

  // Parse Terraform variables from tfvars file
  const tfVars = parseTerraformVariables();

  try {
    // Get all Terraform outputs as JSON
    const outputJson = execSync(
      `terraform -chdir=${terraformDir} output -json`,
      {
        env: { ...process.env, ENVIRONMENT: environment },
        encoding: 'utf-8',
      }
    );

    const outputs: Record<string, TerraformOutput> = JSON.parse(outputJson);

    // Extract values from Terraform output format
    // Prefer environment variables, fall back to tfvars
    const result: TerraformOutputs = {
      drive_scan_trigger_topic: outputs.drive_scan_trigger_topic?.value || '',
      doc_process_trigger_topic: outputs.doc_process_trigger_topic?.value || '',
      document_storage_bucket: outputs.document_storage_bucket?.value || '',
      vision_results_bucket: outputs.vision_results_bucket?.value || '',
      project_id: process.env.PROJECT_ID || tfVars.project_id || '',
      drive_folder_id:
        process.env.DRIVE_FOLDER_ID || tfVars.drive_folder_id || '',
      category_root_folder_id:
        process.env.CATEGORY_ROOT_FOLDER_ID ||
        tfVars.category_root_folder_id ||
        '',
      uncategorized_folder_id:
        process.env.UNCATEGORIZED_FOLDER_ID ||
        tfVars.uncategorized_folder_id ||
        '',
      file_classifier_service_account_email:
        outputs.file_classifier_service_account_email?.value || '',
    };

    cachedOutputs[environment] = result;
    return result;
  } catch (error) {
    throw new Error(
      `Failed to get Terraform outputs for ${environment}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Clear cached Terraform outputs and variables (useful for testing)
 */
export function clearTerraformOutputsCache(): void {
  cachedOutputs = {};
  cachedVariables = null;
}
