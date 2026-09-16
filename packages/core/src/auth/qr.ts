import QRCode from 'qrcode';

/**
 * A QR code as an SVG, for what a phone camera reads rather than what a person types.
 *
 * The one use today is enrolling an authenticator (SEC-02): the code carries the otpauth
 * address, which carries the secret, so it is drawn by the server into the page and never
 * fetched from anywhere.
 */
export async function qrSvg(value: string, width = 176): Promise<string> {
  return QRCode.toString(value, {
    type: 'svg',
    margin: 1,
    errorCorrectionLevel: 'M',
    width,
  });
}
