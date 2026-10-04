/**
 * Toast — Reusables Primitive
 *
 * Non-blocking feedback messages. Uses Reanimated for enter/exit animations.
 * Managed via Zustand store for global access.
 */

import React, { useEffect } from 'react';
import { StyleSheet, type ViewStyle, type TextStyle, View, Text, Pressable } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';
import { create } from 'zustand';
import { PhosphorIcon } from 'phosphor-react-native';
import { cn } from '../../utils/cn';

export type ToastVariant = 'default' | 'success' | 'warning' | 'error' | 'info';

interface Toast {
  id: string;
  message: string;
  variant?: ToastVariant;
  duration?: number;
  action?: { label: string; onPress: () => void };
}

interface ToastState {
  toasts: Toast[];
  add: (toast: Omit<Toast, 'id'>) => string;
  remove: (id: string) => void;
  clear: () => void;
}

const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  add: (toast) => {
    const id = Math.random().toString(36).slice(2, 9);
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }] }));
    return id;
  },
  remove: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}));

export function useToast() {
  return useToastStore();
}

const variantStyles: Record<ToastVariant, { bg: string; fg: string; icon: string; iconColor: string }> = {
  default: { bg: '#F0ECE5', fg: '#020101', icon: 'info', iconColor: '#6B625C' },
  success: { bg: '#E5F1EB', fg: '#1F513B', icon: 'check-circle', iconColor: '#2D6A4F' },
  warning: { bg: '#FFF4D6', fg: '#744D00', icon: 'warning', iconColor: '#8A5A00' },
  error: { bg: '#FDE8E7', fg: '#8E1B12', icon: 'x-circle', iconColor: '#B42318' },
  info: { bg: '#E8F4FD', fg: '#1E4D8C', icon: 'info', iconColor: '#2D6A4F' },
};

function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: (id: string) => void }) {
  const translateX = useSharedValue(400);
  const opacity = useSharedValue(0);
  const { bg, fg, icon, iconColor } = variantStyles[toast.variant ?? 'default'];

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
    opacity: opacity.value,
  }), []);

  useEffect(() => {
    translateX.value = withSpring(0, { damping: 20, stiffness: 200 });
    opacity.value = withTiming(1, { duration: 200 });

    if (toast.duration !== 0) {
      const duration = toast.duration ?? 4000;
      const timer = setTimeout(() => {
        translateX.value = withSpring(400, { damping: 20, stiffness: 200 });
        opacity.value = withTiming(0, { duration: 200 }, () => {
          runOnJS(onRemove)(toast.id);
        });
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [toast.id]);

  return (
    <Animated.View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingHorizontal: 16,
          paddingVertical: 12,
          borderRadius: 12,
          backgroundColor: bg,
          shadowColor: '#020101',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.08,
          shadowRadius: 8,
          elevation: 4,
          minWidth: 280,
          maxWidth: '90%',
        },
        animatedStyle,
      ]}
    >
      <PhosphorIcon name={icon} size={20} weight="bold" color={iconColor} />
      <Text style={{ flex: 1, fontSize: 14, lineHeight: 20, color: fg }}>{toast.message}</Text>
      {toast.action && (
        <Pressable onPress={toast.action.onPress}>
          <Text style={{ fontSize: 14, fontWeight: '600', color: iconColor, textDecorationLine: 'underline' }}>
            {toast.action.label}
          </Text>
        </Pressable>
      )}
      <Pressable onPress={() => onRemove(toast.id)} style={{ padding: 4 }}>
        <PhosphorIcon name="x" size={18} weight="bold" color={iconColor} opacity={0.6} />
      </Pressable>
    </Animated.View>
  );
}

export function ToastContainer() {
  const { toasts, remove } = useToastStore();

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          bottom: 24,
          left: 16,
          right: 16,
          flexDirection: 'column',
          gap: 8,
          zIndex: 1500,
          pointerEvents: 'box-none',
        },
      ]}
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onRemove={remove} />
      ))}
    </Animated.View>
  );
}

export function toast(message: string, options?: Partial<Toast>) {
  return useToastStore.getState().add({ message, ...options });
}

export const toastSuccess = (message: string, options?: Partial<Toast>) =>
  toast(message, { ...options, variant: 'success' });

export const toastError = (message: string, options?: Partial<Toast>) =>
  toast(message, { ...options, variant: 'error' });

export const toastWarning = (message: string, options?: Partial<Toast>) =>
  toast(message, { ...options, variant: 'warning' });

export const toastInfo = (message: string, options?: Partial<Toast>) =>
  toast(message, { ...options, variant: 'info' });