import ExpoModulesCore
import StoreKit

/// Reads the App Store storefront this install belongs to: the country of the
/// Apple ID's App Store account (not the device region or language), as an
/// ISO 3166-1 alpha-3 code — "USA" for the United States.
///
/// The app uses it for one decision only: whether it may link out to
/// horizon.market, which App Store guideline 3.1.1 allows on the US storefront
/// alone. The JS side treats `nil` as "not the US".
public class HorizonStorefrontModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HorizonStorefront")

    AsyncFunction("getCountryCodeAsync") { () async -> String? in
      await Storefront.current?.countryCode
    }
  }
}
