"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { useEffect, useMemo, type ReactNode } from "react";

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  const client = useMemo(() => {
    if (!convexUrl) {
      return null;
    }

    return new ConvexReactClient(convexUrl);
  }, [convexUrl]);

  useEffect(() => {
    return () => {
      client?.close();
    };
  }, [client]);

  if (!client) {
    return <>{children}</>;
  }

  return <ConvexProvider client={client}>{children}</ConvexProvider>;
}
