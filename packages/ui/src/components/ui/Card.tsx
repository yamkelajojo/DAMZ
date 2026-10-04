/**
 * Card — Reusables Primitive
 *
 * Surface container with elevation, padding, radius.
 * Variants: default, elevated, outlined
 */

import React, { type ReactNode } from 'react';
import { StyleSheet, type ViewStyle } from 'react-native';
import { View } from 'react-native';
import { cn } from '../../utils/cn';

export interface CardProps {
  children: ReactNode;
  variant?: 'default' | 'elevated' | 'outlined';
  padding?: 'none' | 'sm' | 'md' | 'lg' | 'comfortable';
  className?: string;
  style?: ViewStyle;
  onPress?: () => void;
}

const paddingStyles: Record<string, ViewStyle> = {
  none: {},
  sm: { padding: 12 },
  md: { padding: 16 },
  lg: { padding: 24 },
  comfortable: { padding: 20 },
};

const variantStyles: Record<string, ViewStyle> = {
  default: {
    backgroundColor: '#F0ECE5',
    borderWidth: 0.5,
    borderColor: '#E6DFD6',
  },
  elevated: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#020101',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
    borderWidth: 0,
  },
  outlined: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#DCCFC4',
  },
};

export function Card({
  children,
  variant = 'default',
  padding = 'md',
  className,
  style,
  onPress,
}: CardProps) {
  const Component = onPress ? 'Pressable' : View;

  return (
    <Component
      style={[
        { borderRadius: 16 },
        variantStyles[variant],
        paddingStyles[padding],
        style,
      ]}
      className={cn(className)}
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
    >
      {children}
    </Component>
  );
}