// French amounts in words (traditional spelling: hyphens below one hundred,
// spaces between hundreds and thousands) for administrative documents (bons de décaissement,
// reçus, attestations). Deterministic, no locale data, standard French rules:
// « quatre-vingts » and « cents » take an s only when they end the number,
// « mille » is invariable, « million » and « milliard » agree in number.
const UNITS=['zéro','un','deux','trois','quatre','cinq','six','sept','huit','neuf','dix','onze','douze','treize','quatorze','quinze','seize','dix-sept','dix-huit','dix-neuf'];
const TENS=['','','vingt','trente','quarante','cinquante','soixante'];

function belowHundred(n,final){
 if(n<20)return UNITS[n];
 const tens=Math.floor(n/10),unit=n%10;
 if(tens===7||tens===9){
  const base=tens===7?'soixante':'quatre-vingt';
  const rest=n-(tens===7?60:80);
  return base+(rest===11&&tens===7?' et onze':'-'+UNITS[rest]);
 }
 if(tens===8)return unit===0?(final?'quatre-vingts':'quatre-vingt'):'quatre-vingt-'+UNITS[unit];
 if(unit===0)return TENS[tens];
 if(unit===1)return TENS[tens]+' et un';
 return TENS[tens]+'-'+UNITS[unit];
}

function belowThousand(n,final){
 const hundreds=Math.floor(n/100),rest=n%100;
 let words='';
 if(hundreds){words=hundreds===1?'cent':UNITS[hundreds]+' cent'+(rest===0&&final?'s':'');}
 if(rest)words+=(words?' ':'')+belowHundred(rest,final);
 return words;
}

/** Integer in French words (0 to 999 999 999 999). */
export function numberToFrenchWords(value){
 const n=Math.trunc(Number(value));
 if(!Number.isFinite(n)||n<0||n>999999999999)throw new RangeError('Montant hors limites.');
 if(n===0)return 'zéro';
 const parts=[],billions=Math.floor(n/1e9),millions=Math.floor(n/1e6)%1000,thousands=Math.floor(n/1000)%1000,rest=n%1000;
 if(billions)parts.push(belowThousand(billions,true)+' milliard'+(billions>1?'s':''));
 if(millions)parts.push(belowThousand(millions,true)+' million'+(millions>1?'s':''));
 if(thousands)parts.push(thousands===1?'mille':belowThousand(thousands,false)+' mille');
 if(rest)parts.push(belowThousand(rest,true));
 return parts.join(' ');
}

/** « Cent cinquante mille (150 000) francs CFA », ready for a voucher. */
export function amountInWords(value,currency='francs CFA'){
 const n=Math.round(Number(value));
 const words=numberToFrenchWords(n),unit=n<=1&&currency==='francs CFA'?'franc CFA':currency;
 const grouped=String(n).replace(/\B(?=(\d{3})+(?!\d))/g,' ');
 const tail=/^(.* )?(million|milliard)s?$/.test(words)?' de ':' ';
 return words.charAt(0).toUpperCase()+words.slice(1)+tail.trimEnd()+' '+unit+' ('+grouped+')';
}
