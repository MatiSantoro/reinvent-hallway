import React from 'react';
import { Image, ImageStyle, StyleProp } from 'react-native';

// White-on-transparent PNGs, tinted with tintColor so one file works for active and inactive.
const SOURCES = {
  plan: require('../../assets/tab-plan.png'),
  explore: require('../../assets/tab-explore.png'),
  week: require('../../assets/tab-week.png'),
  groups: require('../../assets/tab-groups.png'),
};

export type IconName = keyof typeof SOURCES;

export function Icon({ name, size = 30, color, style }: { name: IconName; size?: number; color: string; style?: StyleProp<ImageStyle> }) {
  return <Image source={SOURCES[name]} resizeMode="contain" style={[{ width: size, height: size, tintColor: color }, style]} />;
}

export const LOGO = require('../../assets/logo.png');
