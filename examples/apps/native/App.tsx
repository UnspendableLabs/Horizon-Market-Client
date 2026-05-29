import { StatusBar } from "expo-status-bar";
import { StyleSheet } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { useFonts, Montserrat_400Regular, Montserrat_600SemiBold, Montserrat_700Bold } from "@expo-google-fonts/montserrat";
import { HorizonMarketProvider, SwapList } from "@unspendablelabs/horizon-market-client/react";
import { Header } from "./components/Header.js";
import { getPrivateKey } from "./lib/web3auth.js";
import { colors, HORIZON_THEME } from "./lib/theme.js";

export default function App() {
  const [fontsLoaded] = useFonts({
    Montserrat_400Regular,
    Montserrat_600SemiBold,
    Montserrat_700Bold,
  });

  if (!fontsLoaded) return null;

  return (
    <SafeAreaProvider>
      <HorizonMarketProvider network="mainnet" theme={HORIZON_THEME}>
        <SafeAreaView style={styles.root}>
          <StatusBar style="light" backgroundColor={colors.background} />
          <Header />
          <SwapList
            getPrivateKey={getPrivateKey}
            scrollable
            style={styles.list}
          />
        </SafeAreaView>
      </HorizonMarketProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  list: {
    flex: 1,
  },
});
