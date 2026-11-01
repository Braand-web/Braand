import Studio from "./studio";
import type {Metadata} from "next";
export const metadata: Metadata = {robots:{index:true,follow:true},alternates:{canonical:"https://braand.fun/"}};
export default function Page(){return <Studio/>;}

