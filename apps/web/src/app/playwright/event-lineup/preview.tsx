"use client";
import dynamic from "next/dynamic";
export const EventLineupFixture = dynamic(() => import("./client"), { ssr: false });
