"use client";
import dynamic from "next/dynamic";
export const Fixture = dynamic(() => import("./client"), { ssr: false });

export const NativeFixture = dynamic(() => import("./native-client"), { ssr: false });

export const ComposedFixture = dynamic(() => import("./composed-client"), { ssr: false });
