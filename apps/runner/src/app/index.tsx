import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card } from '@damz/ui';
import {
  startPaymentNotificationInbox,
  type PaymentInboxController,
  type PaymentInboxState,
} from '../services/payment-notification-inbox';
import type { PaymentConfirmedNotification } from '@damz/core';

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const [inbox, setInbox] = useState<PaymentInboxState>({ status: 'starting' });
  const [latestNotification, setLatestNotification] =
    useState<PaymentConfirmedNotification | null>(null);
  const [retryInbox, setRetryInbox] = useState<(() => void) | null>(null);

  useEffect(() => {
    const controller: PaymentInboxController = startPaymentNotificationInbox({
      onStateChange: setInbox,
      onNotification: setLatestNotification,
    });
    setRetryInbox(() => controller.retry);
    return controller.stop;
  }, []);

  const inboxMessage = {
    'not-configured': 'Add the relay URL and trusted Gateway DID to the Runner build environment.',
    starting: 'Starting the native Tor service and opening the encrypted inbox…',
    ready: 'Encrypted inbox is connected. It checks for messages while Runner is open.',
    error: 'The encrypted inbox could not connect. Check the network and inbox setup, then retry.',
  }[inbox.status];

  return (
    <View
      className="flex-1 bg-bg-primary"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <ScrollView className="flex-1" contentContainerClassName="gap-4 p-6">
        <View className="gap-1">
          <Text className="text-title text-text-primary">DAMZ Runner</Text>
          <Text className="text-body text-text-secondary">
            Runner identity and encrypted payment inbox
          </Text>
        </View>

        <Card variant="elevated" className="gap-3">
          <Text className="text-heading text-text-primary">Payment inbox</Text>
          <Text accessibilityLiveRegion="polite" className="text-body text-text-secondary">
            {inboxMessage}
          </Text>
          {inbox.status === 'error' && retryInbox ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry encrypted payment inbox connection"
              onPress={retryInbox}
              className="min-h-12 justify-center rounded-xl bg-damz-primary px-4"
            >
              <Text className="text-body text-text-primary">Retry connection</Text>
            </Pressable>
          ) : null}
          {inbox.runnerDid ? (
            <View className="gap-1">
              <Text className="text-caption text-text-secondary">Runner DID</Text>
              <Text selectable className="text-caption text-text-primary">
                {inbox.runnerDid}
              </Text>
              <Text className="text-caption text-text-secondary">Relay recipient hash</Text>
              <Text selectable className="text-caption text-text-primary">
                {inbox.runnerOnionHash}
              </Text>
            </View>
          ) : null}
        </Card>

        {latestNotification ? (
          <Card variant="elevated" className="gap-2">
            <Text className="text-heading text-text-primary">Payment confirmed</Text>
            <Text className="text-body text-text-secondary">
              Order {latestNotification.orderId.slice(0, 8)} ·{' '}
              {latestNotification.confirmations} confirmations
            </Text>
            <Text className="text-caption text-text-secondary">
              Saved to the encrypted payment history.
            </Text>
          </Card>
        ) : null}
      </ScrollView>
    </View>
  );
}
