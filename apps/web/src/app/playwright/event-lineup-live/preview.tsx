"use client";
import dynamic from "next/dynamic";
export const Fixture = dynamic(() => import("./client"), { ssr: false });
