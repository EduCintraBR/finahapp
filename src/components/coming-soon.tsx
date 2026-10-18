import type { LucideIcon } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function ComingSoon({
  icon: Icon,
  title,
  phase,
  children,
}: {
  icon: LucideIcon;
  title: string;
  phase: number;
  children?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-secondary text-primary">
          <Icon className="size-5" aria-hidden />
        </div>
        <CardTitle>{title}</CardTitle>
        <CardDescription>Chega na Fase {phase} do roadmap.</CardDescription>
      </CardHeader>
      {children && <CardContent className="text-sm text-muted-foreground">{children}</CardContent>}
    </Card>
  );
}
