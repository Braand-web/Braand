import Studio from "./studio";
import type {Metadata} from "next";

const title="Braand — Vos idées, vos prochains clients";
const description="Votre assistant de création, de pages et de croissance. Un espace pour passer de l’idée à l’action.";
const image={url:"https://braand.fun/brand/relais-app-1024.png",width:1024,height:1024,alt:"Braand"};

export const metadata: Metadata = {
  robots:{index:true,follow:true},
  alternates:{canonical:"https://braand.fun/"},
  openGraph:{type:"website",locale:"fr_FR",siteName:"Braand",url:"https://braand.fun/",title,description,images:[image]},
  twitter:{card:"summary",title,description,images:[image.url]},
};
export default function Page(){return <Studio/>;}
