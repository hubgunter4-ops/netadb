import { useEffect, useMemo, type PropsWithChildren } from "react";
import { Animated, Easing, type StyleProp, type ViewStyle } from "react-native";

type AnimatedEntryProps = PropsWithChildren<{
  delay?: number;
  style?: StyleProp<ViewStyle>;
}>;

export function AnimatedEntry({
  children,
  delay = 0,
  style,
}: AnimatedEntryProps) {
  const opacity = useMemo(() => new Animated.Value(0), []);
  const offsetY = useMemo(() => new Animated.Value(12), []);

  useEffect(() => {
    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 360,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(offsetY, {
          toValue: 0,
          duration: 360,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
    }, delay);

    return () => {
      clearTimeout(timer);
      opacity.stopAnimation();
      offsetY.stopAnimation();
    };
  }, [delay, offsetY, opacity]);

  return (
    <Animated.View
      style={[style, { opacity, transform: [{ translateY: offsetY }] }]}
    >
      {children}
    </Animated.View>
  );
}
