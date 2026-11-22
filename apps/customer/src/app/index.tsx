import { Text, View } from 'react-native';
import { Card } from '@damz/ui';

/**
 * Placeholder home route.
 *
 * It exists so the app has a routable entry point and so the toolchain
 * (Expo Router, NativeWind, the design system) is wired end to end. Replace it
 * with the first real screen.
 */
export default function HomeScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-bg-primary p-6">
      <Card variant="elevated" className="w-full gap-2">
        <Text className="text-title text-text-primary">DAMZ Customer</Text>
        <Text className="text-body text-text-secondary">
          Scaffold only — no product screens have been built yet.
        </Text>
      </Card>
    </View>
  );
}
