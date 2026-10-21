FROM mcr.microsoft.com/devcontainers/base:bookworm

# Set by BuildKit; the dpkg fallback below covers the classic builder.
ARG TARGETARCH
# Kept at the version .github/workflows/test.yml installs so local lint
# results match CI.
ARG TFLINT_VERSION=v0.64.0

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
    && apt-get install --no-install-recommends --yes google-cloud-cli yamllint shellcheck shfmt unzip \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# A pinned release with its published checksum, instead of the install script
# from tflint's master branch, so the image cannot change under a rebuild.
RUN ARCH="${TARGETARCH:-$(dpkg --print-architecture)}" \
    && TFLINT_ASSET="tflint_linux_${ARCH}.zip" \
    && TFLINT_URL="https://github.com/terraform-linters/tflint/releases/download/${TFLINT_VERSION}" \
    && cd /tmp \
    && curl -fsSL -o "${TFLINT_ASSET}" "${TFLINT_URL}/${TFLINT_ASSET}" \
    && curl -fsSL -o checksums.txt "${TFLINT_URL}/checksums.txt" \
    && grep " ${TFLINT_ASSET}$" checksums.txt | sha256sum -c - \
    && unzip -o -q "${TFLINT_ASSET}" -d /usr/local/bin \
    && chmod +x /usr/local/bin/tflint \
    && rm -f "${TFLINT_ASSET}" checksums.txt

# Install uv and uvx
COPY --from=ghcr.io/astral-sh/uv:0.13.4 /uv /uvx /bin/

# Switch back to vscode user
USER vscode
