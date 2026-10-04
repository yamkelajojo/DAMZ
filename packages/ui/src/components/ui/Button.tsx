/**
 * Button — Reusables Primitive (shadcn/ui pattern)
 *
 * Variants: primary, secondary, destructive, outline, ghost, link
 * Sizes: sm, md, lg, icon
 * Uses Reanimated 3 for press animation
 */

import React, { forwardRef, type ReactNode } from 'react';
import { StyleSheet, type ViewStyle, type TextStyle } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, Easing } from 'react-native-reanimated';
import { Pressable, Text, View } from 'react-native';
import { cn } from '../../utils/cn';

export interface ButtonProps extends React.ComponentPropsWithoutRef<typeof Pressable> {
  variant?: 'primary' | 'secondary' | 'destructive' | 'outline' | 'ghost' | 'link';
  size?: 'sm' | 'md' | 'lg' | 'icon';
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  fullWidth?: boolean;
  children: ReactNode;
}

const Button = forwardRef<Animated.Pressable, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      loading = false,
      leftIcon,
      rightIcon,
      fullWidth = false,
      disabled,
      className,
      style,
      children,
      onPress,
      ...props
    },
    ref
  ) => {
    const scale = useSharedValue(1);

    const animatedStyle = useAnimatedStyle(() => ({
      transform: [{ scale: scale.value }],
    }), []);

    const handlePressIn = () => {
      scale.value = withSpring(0.96, { damping: 20, stiffness: 200 });
    };

    const handlePressOut = () => {
      scale.value = withSpring(1, { damping: 20, stiffness: 200 });
    };

    const baseStyles: ViewStyle = {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      borderRadius: 12,
      ...(fullWidth ? { width: '100%' } : {}),
    };

    const variantStyles: Record<string, ViewStyle> = {
      primary: {
        backgroundColor: '#FFD801',
      },
      secondary: {
        backgroundColor: '#FFF3CC',
        borderWidth: 1,
        borderColor: '#F0E0A0',
      },
      destructive: {
        backgroundColor: '#B42318',
      },
      outline: {
        backgroundColor: 'transparent',
        borderWidth: 1,
        borderColor: '#DCCFC4',
      },
      ghost: {
        backgroundColor: 'transparent',
      },
      link: {
        backgroundColor: 'transparent',
        paddingHorizontal: 0,
        paddingVertical: 0,
      },
    };

    const sizeStyles: Record<string, ViewStyle> = {
      sm: { paddingHorizontal: 12, paddingVertical: 8, minHeight: 36 },
      md: { paddingHorizontal: 16, paddingVertical: 12, minHeight: 44 },
      lg: { paddingHorizontal: 24, paddingVertical: 16, minHeight: 52 },
      icon: { paddingHorizontal: 12, paddingVertical: 12, minHeight: 44, minWidth: 44 },
    };

    const textStyles: Record<string, TextStyle> = {
      primary: { color: '#020101', fontWeight: '600' },
      secondary: { color: '#B39700', fontWeight: '600' },
      destructive: { color: '#FFFFFF', fontWeight: '600' },
      outline: { color: '#020101', fontWeight: '600' },
      ghost: { color: '#020101', fontWeight: '600' },
      link: { color: '#FFD801', fontWeight: '600', textDecorationLine: 'underline' },
    };

    const textSizeStyles: Record<string, TextStyle> = {
      sm: { fontSize: 13, lineHeight: 18 },
      md: { fontSize: 14, lineHeight: 20 },
      lg: { fontSize: 16, lineHeight: 24 },
      icon: { fontSize: 14, lineHeight: 20 },
    };

    const isDisabled = disabled || loading;

    return (
      <Animated.Pressable
        ref={ref}
        style={[
          baseStyles,
          variantStyles[variant],
          sizeStyles[size],
          isDisabled && { opacity: 0.5 },
          style,
        ]}
        className={cn(className)}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onPress={isDisabled ? undefined : onPress}
        disabled={isDisabled}
        accessibilityRole="button"
        accessibilityState={{ disabled: isDisabled, busy: loading }}
        {...props}
      >
        {loading ? (
          <Animated.View
            style={{
              width: 20,
              height: 20,
              borderRadius: 10,
              borderWidth: 2,
              borderColor: variant === 'primary' || variant === 'secondary' ? '#020101' : '#FFFFFF',
              borderTopColor: 'transparent',
            }}
          />
        ) : (
          <>
            {leftIcon && <View>{leftIcon}</View>}
            <Text
              style={[
                textStyles[variant],
                textSizeStyles[size],
                isDisabled && { opacity: 0.6 },
              ]}
            >
              {children}
            </Text>
            {rightIcon && <View>{rightIcon}</View>}
          </>
        )}
      </Animated.Pressable>
    );
  }
);

Button.displayName = 'Button';

export { Button };