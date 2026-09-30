import { router } from 'expo-router';
import { SubscribeScreen } from '../components/SubscribeScreen';

/** Subscription screen, reachable from Settings → Subscription. */
export default function SubscribeRoute() {
  return (
    <SubscribeScreen
      onUnlocked={() => {
        if (router.canGoBack()) router.back();
        else router.replace('/(tabs)');
      }}
    />
  );
}
