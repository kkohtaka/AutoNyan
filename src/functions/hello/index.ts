import { Request, Response } from 'express';
import { CloudEvent } from '@google-cloud/functions-framework';

interface CloudEventData {
  name?: string;
}

export const helloWorld = async (req: Request | CloudEvent<CloudEventData>, res?: Response) => {
  // Handle both HTTP and CloudEvent requests
  if (res) {
    // HTTP request
    const name = (req.query as { name?: string })?.name || 'World';
    res.status(200).send(`Hello, ${name}!`);
  } else {
    // CloudEvent request
    const cloudEvent = req as CloudEvent<CloudEventData>;
    console.log(`Received CloudEvent: ${cloudEvent.id}`);
    return {
      message: `Hello, ${cloudEvent.data?.name || 'World'}!`
    };
  }
}; 