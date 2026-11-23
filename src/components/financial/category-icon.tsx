'use client';

import {
  Banknote,
  Briefcase,
  Car,
  Coffee,
  CreditCard,
  Gamepad2,
  Heart,
  Home,
  Landmark,
  MoreHorizontal,
  Percent,
  PiggyBank,
  ShoppingBag,
  Smartphone,
  Tag,
  TrendingUp,
  User,
  Utensils,
  Wallet,
} from 'lucide-react';
import type { AccountType } from '@/types/financial';

export const CATEGORY_ICON_CHOICES = [
  { key: 'utensils', label: 'อาหาร' },
  { key: 'coffee', label: 'กาแฟ' },
  { key: 'car', label: 'เดินทาง' },
  { key: 'home', label: 'ที่พัก' },
  { key: 'shopping-bag', label: 'ช้อปปิ้ง' },
  { key: 'banknote', label: 'เงินเดือน' },
  { key: 'briefcase', label: 'งาน/ฟรีแลนซ์' },
  { key: 'trending-up', label: 'ลงทุน' },
  { key: 'heart', label: 'สุขภาพ' },
  { key: 'gamepad-2', label: 'บันเทิง' },
  { key: 'smartphone', label: 'มือถือ/เน็ต' },
  { key: 'percent', label: 'ดอกเบี้ย' },
  { key: 'tag', label: 'อื่นๆ' },
] as const;

export function CategoryIcon({
  icon,
  className = 'w-4 h-4',
}: {
  icon?: string | null;
  className?: string;
}) {
  switch (icon) {
    case 'utensils':
      return <Utensils className={className} />;
    case 'coffee':
      return <Coffee className={className} />;
    case 'car':
      return <Car className={className} />;
    case 'home':
      return <Home className={className} />;
    case 'shopping-bag':
      return <ShoppingBag className={className} />;
    case 'banknote':
      return <Banknote className={className} />;
    case 'briefcase':
      return <Briefcase className={className} />;
    case 'trending-up':
      return <TrendingUp className={className} />;
    case 'heart':
      return <Heart className={className} />;
    case 'gamepad-2':
      return <Gamepad2 className={className} />;
    case 'smartphone':
      return <Smartphone className={className} />;
    case 'percent':
      return <Percent className={className} />;
    case 'user':
      return <User className={className} />;
    case 'more-horizontal':
      return <MoreHorizontal className={className} />;
    default:
      return <Tag className={className} />;
  }
}

export function AccountIcon({
  type,
  className = 'w-4 h-4',
}: {
  type: AccountType;
  className?: string;
}) {
  switch (type) {
    case 'bank':
      return <Landmark className={className} />;
    case 'cash':
      return <Banknote className={className} />;
    case 'wallet':
      return <Smartphone className={className} />;
    case 'investment':
      return <PiggyBank className={className} />;
    case 'credit_card':
    case 'loan':
      return <CreditCard className={className} />;
    default:
      return <Wallet className={className} />;
  }
}
