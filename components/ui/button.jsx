import * as React from 'react';
import { cva } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import { cn } from '@/lib/utils';

// Chunky game buttons: flat colour, thick border, solid edge that the button drops onto when pressed.
const buttonVariants = cva(
  'sticker press inline-flex shrink-0 items-center justify-center gap-2 rounded-2xl border-2 font-display font-bold whitespace-nowrap outline-none select-none disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-5',
  {
    variants: {
      variant: {
        default: 'bg-hunt text-hunt-ink border-hunt-edge [--sticker-edge:var(--hunt-edge)]',
        chicken: 'bg-chick text-chick-ink border-chick-edge [--sticker-edge:var(--chick-edge)]',
        found: 'bg-found text-found-ink border-found-edge [--sticker-edge:var(--found-edge)]',
        alert: 'bg-alert text-alert-ink border-alert-edge [--sticker-edge:var(--alert-edge)]',
        clue: 'bg-clue text-clue-ink border-clue-edge [--sticker-edge:var(--clue-edge)]',
        destructive: 'bg-alert text-alert-ink border-alert-edge [--sticker-edge:var(--alert-edge)]',
        secondary: 'bg-card-2 text-foreground border-border',
        outline: 'bg-transparent text-foreground border-border',
        ghost: 'bg-transparent text-muted-foreground border-transparent [--sticker-edge:transparent] hover:text-foreground',
        link: 'border-transparent [--sticker-edge:transparent] text-hunt underline-offset-4 hover:underline',
      },
      size: {
        default: 'min-h-12 px-5 text-lg',
        sm: 'min-h-11 px-3.5 text-base rounded-xl',
        lg: 'min-h-14 px-6 text-xl',
        icon: 'size-12',
      },
      block: { true: 'w-full', false: '' },
    },
    defaultVariants: { variant: 'default', size: 'default', block: false },
  }
);

function Button({ className, variant, size, block, asChild = false, ...props }) {
  const Comp = asChild ? Slot.Root : 'button';
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, block, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
