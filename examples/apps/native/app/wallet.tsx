import { useRouter } from "expo-router";
import { WalletScreen } from "../components/WalletScreen.js";

// The wallet screen. Android hardware back is handled by expo-router's Stack, and
// the in-screen back arrow calls router.back() (replaces the old manual screen state
// + BackHandler in App.tsx).
export default function Wallet() {
  const router = useRouter();
  return <WalletScreen onBack={() => router.back()} />;
}
