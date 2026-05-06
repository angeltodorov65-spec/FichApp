import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Languages } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export const LanguageSwitcher: React.FC = () => {
  const { i18n } = useTranslation();

  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng);
  };

  const currentLanguageName = i18n.language === 'bg' ? 'BG' : i18n.language === 'es' ? 'ES' : 'EN';

  return (
    <div className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger 
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            "h-9 gap-2 border-zinc-200 bg-white cursor-pointer dark:bg-zinc-950 dark:border-zinc-800"
          )}
        >
          <Languages className="h-4 w-4 text-zinc-500" />
          <span className="font-medium text-xs text-zinc-700 dark:text-zinc-300">{currentLanguageName}</span>
          <span className="text-[10px] text-zinc-400">▼</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-32">
          <DropdownMenuItem onClick={() => changeLanguage('bg')} className="cursor-pointer">
            <span className={i18n.language === 'bg' ? 'font-bold text-zinc-900 dark:text-white' : 'text-zinc-600 dark:text-zinc-400'}>
              Български
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => changeLanguage('en')} className="cursor-pointer">
            <span className={i18n.language === 'en' ? 'font-bold text-zinc-900 dark:text-white' : 'text-zinc-600 dark:text-zinc-400'}>
              English
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => changeLanguage('es')} className="cursor-pointer">
            <span className={i18n.language === 'es' ? 'font-bold text-zinc-900 dark:text-white' : 'text-zinc-600 dark:text-zinc-400'}>
              Español
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};
