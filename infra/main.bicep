targetScope = 'resourceGroup'

@description('Azure location for all regional resources.')
param location string = resourceGroup().location

@description('Base name prefix for application resources.')
param appName string = 'aplc'

@description('Container registry name.')
param acrName string = 'aplcregistry2026'

@description('Container registry username used for image pulls during app deployment.')
@secure()
param acrUsername string

@description('Container registry password used for image pulls during app deployment.')
@secure()
param acrPassword string

@description('Log Analytics workspace name.')
param logAnalyticsName string = 'aplc-logs'

@description('Application Insights resource name.')
param appInsightsName string = 'aplc-insights'

@description('Container Apps environment name.')
param containerAppsEnvironmentName string = 'aplc-env-vnet'

@description('Deploy the container app and its role assignment. Disable for infra-only staging runs.')
param deployContainerApp bool = true

@description('Virtual network name for the Container Apps and private endpoint path.')
param vnetName string = 'aplc-vnet'

@description('Address prefix for the virtual network.')
param vnetAddressPrefix string = '10.42.0.0/22'

@description('Subnet name used by the Container Apps managed environment.')
param acaInfrastructureSubnetName string = 'aca-infra'

@description('Address prefix for the Container Apps infrastructure subnet.')
param acaInfrastructureSubnetPrefix string = '10.42.0.0/23'

@description('Subnet name used by private endpoints.')
param privateEndpointSubnetName string = 'private-endpoints'

@description('Address prefix for the private endpoint subnet.')
param privateEndpointSubnetPrefix string = '10.42.2.0/27'

@description('Private DNS zone used for Azure Blob private endpoint resolution.')
param privateDnsZoneName string = 'privatelink.blob.${environment().suffixes.storage}'

@description('Docker bridge CIDR for the VNet-enabled Container Apps environment.')
param acaDockerBridgeCidr string = '172.16.0.1/28'

@description('Storage account name for persistent user data.')
param storageAccountName string = 'aplcfiles2026'

@description('Blob container name used for user data.')
param storageContainerName string = 'userdata'

@description('Azure Container App name.')
param containerAppName string = 'aplc-app'

@description('Container image to deploy.')
param containerImage string = '${acrName}.azurecr.io/aplc:latest'

@description('Allowed browser origin for CORS.')
param corsAllowedOrigins string = ''

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
  parent: storage
  name: 'default'
}

resource userDataContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: storageContainerName
  properties: {
    publicAccess: 'None'
  }
}

resource virtualNetwork 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: vnetName
  location: location
  properties: {
    addressSpace: {
      addressPrefixes: [
        vnetAddressPrefix
      ]
    }
    subnets: [
      {
        name: acaInfrastructureSubnetName
        properties: {
          addressPrefix: acaInfrastructureSubnetPrefix
          delegations: [
            {
              name: 'container-apps'
              properties: {
                serviceName: 'Microsoft.App/environments'
              }
            }
          ]
        }
      }
      {
        name: privateEndpointSubnetName
        properties: {
          addressPrefix: privateEndpointSubnetPrefix
          privateEndpointNetworkPolicies: 'Disabled'
        }
      }
    ]
  }
}

resource acaInfrastructureSubnet 'Microsoft.Network/virtualNetworks/subnets@2024-05-01' existing = {
  parent: virtualNetwork
  name: acaInfrastructureSubnetName
}

resource privateEndpointSubnet 'Microsoft.Network/virtualNetworks/subnets@2024-05-01' existing = {
  parent: virtualNetwork
  name: privateEndpointSubnetName
}

resource privateDnsZone 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: privateDnsZoneName
  location: 'global'
}

resource privateDnsZoneVirtualNetworkLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = {
  parent: privateDnsZone
  name: '${vnetName}-link'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: virtualNetwork.id
    }
  }
}

resource blobPrivateEndpoint 'Microsoft.Network/privateEndpoints@2024-05-01' = {
  name: '${storageAccountName}-blob-pe'
  location: location
  properties: {
    subnet: {
      id: privateEndpointSubnet.id
    }
    privateLinkServiceConnections: [
      {
        name: '${storageAccountName}-blob-connection'
        properties: {
          privateLinkServiceId: storage.id
          groupIds: [
            'blob'
          ]
        }
      }
    ]
  }
}

resource blobPrivateEndpointDnsZoneGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2024-05-01' = {
  parent: blobPrivateEndpoint
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: 'blob-zone'
        properties: {
          privateDnsZoneId: privateDnsZone.id
        }
      }
    ]
  }
}

resource managedEnvironment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: containerAppsEnvironmentName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
    vnetConfiguration: {
      infrastructureSubnetId: acaInfrastructureSubnet.id
      internal: false
      dockerBridgeCidr: acaDockerBridgeCidr
    }
  }
}

module containerAppDeployment './container-app.bicep' = if (deployContainerApp) {
  name: 'container-app'
  params: {
    location: location
    appName: appName
    containerAppName: containerAppName
    managedEnvironmentId: managedEnvironment.id
    registryServer: acr.properties.loginServer
    registryUsername: acrUsername
    registryPassword: acrPassword
    containerImage: containerImage
    googleClientId: googleClientId
    authAllowedEmail: authAllowedEmail
    authSessionSecret: authSessionSecret
    openAiApiKey: openAiApiKey
    openAiModel: openAiModel
    storageAccountName: storage.name
    storageContainerName: storageContainerName
    applicationInsightsConnectionString: resolvedAppInsightsConnectionString
    corsAllowedOrigins: corsAllowedOrigins
    minReplicas: minReplicas
    maxReplicas: maxReplicas
    containerCpu: containerCpu
    containerMemory: containerMemory
    roleAssignmentStorageAccountName: storage.name
    roleAssignmentContainerName: storageContainerName
  }
}

resource errorSpikeAlert 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = {
  name: '${appName}-error-spike'
  location: location
  properties: {
    description: 'Alert when 5+ errors in 15 min'
    enabled: true
    evaluationFrequency: 'PT5M'
    scopes: [
      logAnalytics.id
    ]
    severity: 2
    windowSize: 'PT15M'
    criteria: {
      allOf: [
        {
          query: '''
            ContainerAppConsoleLogs_CL
            | where ContainerAppName_s == '${containerAppName}' and Log_s contains 'ERROR'
          '''
          threshold: 5
          operator: 'GreaterThan'
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

output managedEnvironmentId string = managedEnvironment.id
output storageAccountId string = storage.id
output storageContainerId string = userDataContainer.id
output applicationInsightsResourceId string = applicationInsights.id
output virtualNetworkId string = virtualNetwork.id
output privateDnsZoneId string = privateDnsZone.id
output blobPrivateEndpointId string = blobPrivateEndpoint.id
