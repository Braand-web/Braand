// Catch explicitly labelled secrets before persistence or model dispatch.
// An arbitrary unlabelled string cannot reliably be identified as a password.
export function containsExplicitLoginSecret(text){
 return typeof text==='string'&&/(?:\bpassword\b|\bmot\s+de\s+passe\b|\bcontrase(?:ñ|n)a\b|\bpasswort\b|\bcode\s+(?:2fa|otp|sms|de\s+connexion|de\s+vérification)\b)\s*[:=]\s*\S.*/iu.test(text);
}
