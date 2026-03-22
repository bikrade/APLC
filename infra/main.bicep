targetScope = 'resourceGroup'

@description('Azure location for all regional resources.')
param location string = resourceGroup().location

@description('Base name prefix for application resources.')
param appName string = 'aplc'

@description('Container registry name.')
param acrName string = 'aplcregistry2026'

@description('Log Analytics workspace name.')
param logAnalyticsName string = 'aplc-logs'

@description('Application Insights resource name.')
param appInsightsName string = 'aplc-insights'

@description('Container Apps environment name.')
param containerAppsEnvironmentName string = 'aplc-env'

@description('Storage account name for persistent user data.')
param storageAccountName string = 'aplcfiles2026'

@description('Blob container name used for user data.')
param storageContainerName string = 'userdata'

@description('Azure Container App name.')
param containerAppName string = 'aplc-app'

@description('Container image to deploy.')
param containerImage string = '${acrName}.azurecr.io/aplc:latest'

@description('Allowed browser origin for CORS.')
param corsAllowedOrigins string = 'https://aplc-app.redriver-82b9ce7a.eastus.azurecontainerapps.io'

@description('OpenAI model name.')
param openAiModel string = 'gpt-4o-mini'

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

@description('Application Insights connection string. Leave empty to use the newly created resource output.')
@secure()
param appInsightsConnectionString string = ''

@description('Minimum replica count for the container app.')
param minReplicas int = 0

@description('Maximum replica count for the container app.')
param maxReplicas int = 1

@description('CPU allocated to the app container.')
param containerCpu string = '0.5'

@description('Memory allocated to the app container.')
param containerMemory string = '1.0Gi'

var storageBlobDataContributorRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
var resolvedAppInsightsConnectionString = empty(appInsightsConnectionString)
  ? applicationInsights.properties.ConnectionString
  : appInsightsConnectionString

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logAnalyticsName
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
    features: {
      enableLogAccessUsingOnlyResourcePermissions: true
    }
  }
}

resource applicationInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
  }
}

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: acrName
  location: location
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: false
    publicNetworkAccess: 'Enabled'
  }
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    allowBlobPublicAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    accessTier: 'Hot'
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  name: '${storage.name}/default'
}

resource userDataContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  name: '${storage.name}/default/${storageContainerName}'
  properties: {
    publicAccess: 'None'
  }
  dependsOn: [
    blobService
  ]
}

resource managedEnvironment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: containerAppsEnvironmentName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: listKeys(logAnalytics.id, '2023-09-01').primarySharedKey
      }
    }
  }
}

resource containerApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: containerAppName
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    managedEnvironmentId: managedEnvironment.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3001
        transport: 'Auto'
      }
      registries: [
        {
          server: acr.properties.loginServer
          identity: 'system'
        }
      ]
      secrets: [
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
              value: storage.name
            }
            {
              name: 'AZURE_STORAGE_CONTAINER'
              value: storageContainerName
            }
            {
              name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
              value: resolvedAppInsightsConnectionString
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
  name: guid(storage.id, containerApp.id, storageBlobDataContributorRoleId)
  scope: storage
  properties: {
    principalId: containerApp.identity.principalId
    roleDefinitionId: storageBlobDataContributorRoleId
    principalType: 'ServicePrincipal'
  }
}

resource errorSpikeAlert 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = {
  name: '${appName}-error-spike'
  location: location
  properties: {
    description: 'Alert when the app emits multiple errors in a short window.'
    enabled: true
    evaluationFrequency: 'PT5M'
    scopes: [
      applicationInsights.id
    ]
    severity: 2
    windowSize: 'PT15M'
    criteria: {
      allOf: [
        {
          criterionType: 'StaticThresholdCriterion'
          query: 'exceptions | where timestamp > ago(15m) | summarize AggregatedValue = count()'
          threshold: 5
          operator: 'GreaterThanOrEqual'
          timeAggregation: 'Count'
          failingPeriods: {
            minFailingPeriodsToAlert: 1
            numberOfEvaluationPeriods: 1
          }
        }
      ]
    }
    autoMitigate: true
  }
}

resource restartAlert 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = {
  name: '${appName}-restart-alert'
  location: location
  properties: {
    description: 'Alert when the container app restarts repeatedly.'
    enabled: true
    evaluationFrequency: 'PT5M'
    scopes: [
      logAnalytics.id
    ]
    severity: 1
    windowSize: 'PT15M'
    criteria: {
      allOf: [
        {
          criterionType: 'StaticThresholdCriterion'
          query: '''
            ContainerAppSystemLogs_CL
            | where ContainerAppName_s == '${containerAppName}'
            | where Log_s contains 'restart'
            | summarize AggregatedValue = count()
          '''
          threshold: 3
          operator: 'GreaterThanOrEqual'
          timeAggregation: 'Count'
          failingPeriods: {
            minFailingPeriodsToAlert: 1
            numberOfEvaluationPeriods: 1
          }
        }
      ]
    }
    autoMitigate: true
  }
}

output containerAppUrl string = 'https://${containerApp.properties.configuration.ingress.fqdn}'
output storageAccountId string = storage.id
output storageContainerId string = userDataContainer.id
output applicationInsightsResourceId string = applicationInsights.id
