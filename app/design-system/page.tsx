import type {Metadata} from "next";
import {DesignSystemShowcase} from "@/components/ds/showcase";

export const metadata: Metadata = {title: "Design system | Braand", robots: {index: false, follow: false}};
export default function DesignSystemPage() {return <DesignSystemShowcase/>;}
