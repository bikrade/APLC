targetScope = 'resourceGroup'

@description('Azure location for the container app.')
param location string

@description('Base name prefix for the app container.')
param appName string

@description('Azure Container App name.')
param containerAppName string

@description('Managed environment resource ID for the container app.')
param managedEnvironmentId string

@description('ACR login server used by the container app.')
param registryServer string

@description('ACR username used by the container app to pull images.')
@secure()
param registryUsername string

@description('ACR password used by the container app to pull images.')
@secure()
param registryPassword string

@description('Container image to deploy.')
param containerImage string

@description('Google OAuth client ID.')
@secure()
param googleClientId string

@description('Allowed email for login.')
@secure()
param authAllowedEmail string

@description('Session signing secret.')
@secure()
param authSessionSecret string

@description('OpenAI API key.')
@secure()
param openAiApiKey string

@description('OpenAI model name.')
param openAiModel string

@description('Storage account name for persistent user data.')
param storageAccountName string

@description('Blob container name used for user data.')
param storageContainerName string

@description('Application Insights connection string to inject into the container app.')
@secure()
param applicationInsightsConnectionString string

@description('Allowed browser origin for CORS.')
param corsAllowedOrigins string

@description('Minimum replica count for the container app.')
param minReplicas int

@description('Maximum replica count for the container app.')
param maxReplicas int

@description('CPU allocated to the app container.')
param containerCpu string

@description('Memory allocated to the app container.')
param containerMemory string

@description('Existing storage account name that holds the blob container scope for RBAC.')
param roleAssignmentStorageAccountName string

@description('Existing blob container name that holds the RBAC scope.')
param roleAssignmentContainerName string

var storageBlobDataContributorRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')

resource roleAssignmentStorage 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: roleAssignmentStorageAccountName
}

resource roleAssignmentBlobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' existing = {
  parent: roleAssignmentStorage
  name: 'default'
}

resource roleAssignmentContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' existing = {
  parent: roleAssignmentBlobService
  name: roleAssignmentContainerName
}

resource containerApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: containerAppName
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    managedEnvironmentId: managedEnvironmentId
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3001
        transport: 'Auto'
      }
      registries: [
        {
          server: registryServer
          username: registryUsername
          passwordSecretRef: 'registry-password'
        }
      ]
      secrets: [
        {
          name: 'registry-password'
          value: registryPassword
        }
        {
          name: 'openai-key'
          value: openAiApiKey
        }
        {
          name: 'google-client-id'
          value: googleClientId
        }
        {
          name: 'auth-email'
          value: authAllowedEmail
        }
        {
          name: 'session-secret'
          value: authSessionSecret
        }
      ]
    }
    template: {
      containers: [
        {
          name: appName
          image: containerImage
          resources: {
            cpu: json(containerCpu)
            memory: containerMemory
          }
          env: [
            {
              name: 'PORT'
              value: '3001'
            }
            {
              name: 'OPENAI_MODEL'
              value: openAiModel
            }
            {
              name: 'DATA_ROOT'
              value: '/app/data'
            }
            {
              name: 'AZURE_STORAGE_ACCOUNT'
              value: storageAccountName
            }
            {
              name: 'AZURE_STORAGE_CONTAINER'
              value: storageContainerName
            }
            {
              name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
              value: applicationInsightsConnectionString
            }
            {
              name: 'CORS_ALLOWED_ORIGINS'
              value: corsAllowedOrigins
            }
            {
              name: 'OPENAI_API_KEY'
              secretRef: 'openai-key'
            }
            {
              name: 'GOOGLE_CLIENT_ID'
              secretRef: 'google-client-id'
            }
            {
              name: 'AUTH_ALLOWED_EMAIL'
              secretRef: 'auth-email'
            }
            {
              name: 'AUTH_SESSION_SECRET'
              secretRef: 'session-secret'
            }
          ]
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/health'
                port: 3001
              }
              initialDelaySeconds: 10
              periodSeconds: 30
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/health'
                port: 3001
              }
              initialDelaySeconds: 5
              periodSeconds: 10
            }
            {
              type: 'Startup'
              httpGet: {
                path: '/health'
                port: 3001
              }
              initialDelaySeconds: 5
              periodSeconds: 5
              failureThreshold: 20
            }
          ]
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
      }
    }
  }
}

resource blobContributorAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(roleAssignmentContainer.id, containerApp.id, storageBlobDataContributorRoleId)
  scope: roleAssignmentContainer
  properties: {
    principalId: containerApp.identity.principalId
    roleDefinitionId: storageBlobDataContributorRoleId
    principalType: 'ServicePrincipal'
  }
}

output containerAppUrl string = 'https://${containerApp.properties.configuration.ingress.fqdn}'
