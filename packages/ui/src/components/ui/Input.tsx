/**
 * Input — Reusables Primitive
 *
 * NativeWind styled TextInput with label, error, helper text.
 * Uses Reanimated for focus animations.
 */

import React, { forwardRef, type ReactNode } from 'react';
import { StyleSheet, type ViewStyle, type TextStyle, TextInput } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { View, Text, TextInput as RNTextInput } from 'react-native';
import { cn } from '../../utils/cn';

export interface InputProps extends React.ComponentPropsWithoutRef<typeof RNTextInput> {
  label?: string;
  error?: string;
  helperText?: string;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  className?: string;
  containerClassName?: string;
}

const Input = forwardRef<RNTextInput, InputProps>(
  (
    {
      label,
      error,
      helperText,
      leftIcon,
      rightIcon,
      className,
      containerClassName,
      disabled,
      required,
      style,
      ...props
    },
    ref
  ) => {
    const borderColor = useSharedValue('#DCCFC4');
    const labelColor = useSharedValue('#6B625C');

    const animatedBorderStyle = useAnimatedStyle(() => ({
      borderColor: borderColor.value,
    }), []);

    const animatedLabelStyle = useAnimatedStyle(() => ({
      color: labelColor.value,
    }), []);

    const handleFocus = () => {
      borderColor.value = withTiming('#FFD801', { duration: 150 });
      labelColor.value = withTiming('#FFD801', { duration: 150 });
    };

    const handleBlur = () => {
      borderColor.value = withTiming(error ? '#B42318' : '#DCCFC4', { duration: 150 });
      labelColor.value = withTiming('#6B625C', { duration: 150 });
    };

    const hasError = Boolean(error);

    return (
      <View className={cn('gap-2 w-full', containerClassName)}>
        {label && (
          <Animated.Text
            style={[
              { fontSize: 14, lineHeight: 20, fontWeight: '500', letterSpacing: 0.2 },
              animatedLabelStyle,
            ]}
          >
            {label} {required && <Text style={{ color: '#B42318' }}>*</Text>}
          </Animated.Text>
        )}
        <View
          style={[
            {
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: '#F0ECE5',
              borderWidth: 1,
              borderRadius: 12,
              paddingHorizontal: 12,
              gap: 8,
            },
            animatedBorderStyle,
            disabled && { backgroundColor: '#F0ECE5', opacity: 0.6 },
          ]}
        >
          {leftIcon && <View style={{ paddingLeft: 4 }}>{leftIcon}</View>}
          <Animated.TextInput
            ref={ref}
            style={[
              {
                flex: 1,
                fontSize: 16,
                lineHeight: 24,
                color: '#020101',
                paddingVertical: 12,
                paddingRight: rightIcon ? 0 : 12,
              },
              style,
            ]}
            className={cn(className)}
            onFocus={handleFocus}
            onBlur={handleBlur}
            disabled={disabled}
            {...props}
          />
          {rightIcon && <View style={{ paddingRight: 4 }}>{rightIcon}</View>}
        </View>
        {(error || helperText) && (
          <Text
            style={[
              { fontSize: 12, lineHeight: 16, fontWeight: '500' },
              error ? { color: '#B42318' } : { color: '#7B716A' },
            ]}
          >
            {error ?? helperText}
          </Text>
        )}
      </View>
    );
  }
);

Input.displayName = 'Input';

export { Input };