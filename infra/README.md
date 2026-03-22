# Infrastructure as Code

This folder contains the Azure infrastructure definition for APLC.

## What It Provisions

- Azure Container Registry
- Log Analytics workspace
- Application Insights
- Azure Blob Storage account + `userdata` container
- Azure Container Apps environment
- Azure Container App with system-assigned managed identity
- Storage Blob Data Contributor role assignment for the app identity
- Azure Monitor scheduled query alerts for errors and restart spikes

## Deploy

Create a resource group first if needed:

```bash
az group create --name aplc-rg --location eastus
```

Copy the example parameter file and replace secure placeholder values:

```bash
cp infra/main.parameters.example.json infra/main.parameters.json
```

Run the deployment:

```bash
az deployment group create \
  --resource-group aplc-rg \
  --template-file infra/main.bicep \
  --parameters @infra/main.parameters.json
```

## Notes

- The container image parameter defaults to `aplcregistry2026.azurecr.io/aplc:latest`.
- The Container App is configured for single revision mode and scale-to-zero by default.
- The Bicep template is designed to replace the current imperative Azure CLI setup in CI/CD with a reproducible baseline.
