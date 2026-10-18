Pod::Spec.new do |s|
  s.name           = 'HorizonStorefront'
  s.version        = '1.0.0'
  s.summary        = 'Reads the App Store storefront country through StoreKit.'
  s.description    = s.summary
  s.license        = 'MIT'
  s.author         = 'Unspendable Labs'
  s.homepage       = 'https://horizon.market'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'StoreKit'

  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
