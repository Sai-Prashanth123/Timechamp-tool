'use client';

import { useState } from 'react';
import { useScreenshots } from '@/hooks/use-monitoring';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';

interface Props {
  userId?: string;
  from?: string;
  to?: string;
}

export function ScreenshotGallery({ userId, from, to }: Props) {
  const { data: screenshots = [], isLoading } = useScreenshots({ userId, from, to });
  const [lightbox, setLightbox] = useState<string | null>(null);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-slate-400 text-sm">
          Loading screenshots...
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Screenshots ({screenshots.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {screenshots.length === 0 ? (
            <p className="text-center text-slate-400 text-sm py-4">
              No screenshots for this period.
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {screenshots.map((sc) => (
                <button
                  key={sc.id}
                  className="relative rounded-lg overflow-hidden border border-slate-200 hover:border-blue-400 hover:ring-2 hover:ring-blue-200 transition-all aspect-video bg-slate-100 group"
                  onClick={() => setLightbox(sc.url)}
                  aria-label={`Screenshot taken at ${new Date(sc.capturedAt).toLocaleTimeString()}`}
                >
                  {sc.url ? (
                    <img
                      src={sc.url}
                      alt="Screenshot"
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-300 text-xs">
                      No preview
                    </div>
                  )}
                  <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[10px] px-1.5 py-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    {new Date(sc.capturedAt).toLocaleTimeString(undefined, {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <div className="relative max-w-5xl w-full" onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="sm"
              className="absolute -top-10 right-0 text-white hover:text-white hover:bg-white/20"
              onClick={() => setLightbox(null)}
            >
              <X className="h-5 w-5" />
              <span className="sr-only">Close</span>
            </Button>
            <img
              src={lightbox}
              alt="Screenshot fullscreen"
              className="w-full rounded-lg shadow-2xl"
            />
          </div>
        </div>
      )}
    </>
  );
}
