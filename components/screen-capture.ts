// One still image of the user's own Braand tab, only after their click and the
// browser's permission prompt. The stream is stopped as soon as the frame is read.
export class ScreenCaptureUnavailable extends Error {}

export async function captureCurrentTab(): Promise<File> {
  const media = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
  if (!media?.getDisplayMedia) throw new ScreenCaptureUnavailable("Votre navigateur ne permet pas de partager l’écran ici. Faites une capture (Impr. écran) et joignez-la avec le bouton +.");
  let stream: MediaStream;
  try {
    stream = await media.getDisplayMedia({video: {displaySurface: "browser"}, audio: false, preferCurrentTab: true, selfBrowserSurface: "include"} as DisplayMediaStreamOptions);
  } catch {
    throw new ScreenCaptureUnavailable("Partage annulé. Rien n’a été envoyé à Braand.");
  }
  try {
    const video = document.createElement("video");
    video.muted = true; video.playsInline = true; video.srcObject = stream;
    await video.play();
    // Let one frame arrive before reading it.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const scale = Math.min(1, 1600 / Math.max(1, video.videoWidth));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob) throw new ScreenCaptureUnavailable("La capture n’a pas pu être lue. Réessayez.");
    const stamp = new Date().toLocaleString("fr-FR", {day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"}).replace(/[/: ]/g, "-");
    return new File([blob], `ecran-braand-${stamp}.jpg`, {type: "image/jpeg"});
  } finally {
    stream.getTracks().forEach(track => track.stop());
  }
}
