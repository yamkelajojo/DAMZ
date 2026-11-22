/**
 * Card — Reusables Primitive
 *
 * Surface container with elevation, padding, radius.
 * Variants: default, elevated, outlined
 */

import React, { type ReactNode } from 'react';
import { View, Pressable, type ViewStyle } from 'react-native';
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
  const surfaceStyle = [
    { borderRadius: 16 } as ViewStyle,
    variantStyles[variant],
    paddingStyles[padding],
    style,
  ];

  // A `Pressable` and a `View` take different props, so the element is chosen
  // rather than switching on a string tag: `const Component = onPress ?
  // 'Pressable' : View` produces a component that TypeScript cannot construct
  // and that React would render as a host element named "Pressable".
  if (onPress) {
    return (
      <Pressable
        style={surfaceStyle}
        className={cn(className)}
        onPress={onPress}
        accessibilityRole="button"
      >
        {children}
      </Pressable>
    );
  }

  return (
    <View style={surfaceStyle} className={cn(className)}>
      {children}
    </View>
  );
}