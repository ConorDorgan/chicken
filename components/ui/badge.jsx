import * as React from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center justify-center gap-1 rounded-full border-2 px-2.5 py-0.5 text-xs font-extrabold whitespace-nowrap [&>svg]:size-3.5',
  {
    variants: {
      variant: {
        default: 'bg-card-2 text-foreground border-border',
        hunt: 'bg-hunt text-hunt-ink border-hunt-edge',
        found: 'bg-found text-found-ink border-found-edge',
        alert: 'bg-alert text-alert-ink border-alert-edge',
        clue: 'bg-clue text-clue-ink border-clue-edge',
        chicken: 'bg-chick text-chick-ink border-chick-edge',
        head: 'bg-head text-head-ink border-head-edge',
      },
    },
    defaultVariants: { variant: 'default' },
  }
);

function Badge({ className, variant, ...props }) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
