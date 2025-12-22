FROM mcr.microsoft.com/devcontainers/base:bookworm

# Copy .nvmrc to read Node.js version
COPY .nvmrc /tmp/.nvmrc

# Switch to vscode user and install Node.js via nvm
USER vscode
RUN curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash \
    && export NVM_DIR="$HOME/.nvm" \
    && [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh" \
    && NODE_VERSION=$(cat /tmp/.nvmrc | tr -d '\n\r') \
    && nvm install $NODE_VERSION \
    && nvm use $NODE_VERSION \
    && nvm alias default $NODE_VERSION \
    && npm install -g typescript typescript-language-server

# Set environment variables using Node version from .nvmrc
USER root
RUN NODE_VERSION=$(cat /tmp/.nvmrc | tr -d '\n\r') \
    && echo "export NVM_DIR=\"/home/vscode/.nvm\"" >> /etc/environment \
    && echo "export PATH=\"/home/vscode/.nvm/versions/node/v$NODE_VERSION/bin:\$PATH\"" >> /etc/environment

ENV NVM_DIR="/home/vscode/.nvm"
USER vscode

# Install Google Cloud SDK and development tools
USER root
RUN curl https://packages.cloud.google.com/apt/doc/apt-key.gpg | gpg --dearmor -o /usr/share/keyrings/cloud.google.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" | tee -a /etc/apt/sources.list.d/google-cloud-sdk.list \
    && apt-get update \
    && apt-get install --no-install-recommends --yes google-cloud-cli yamllint shellcheck shfmt \
    && curl -s https://raw.githubusercontent.com/terraform-linters/tflint/master/install_linux.sh | bash \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install uv and uvx
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# Switch back to vscode user
USER vscode
