import asioLogo from '../../assets/logos/ASIO_Compatible_Logo_Steinberg_white.svg';
import vstLogo from '../../assets/logos/VST_Compatible_Logo_Steinberg_negative.svg';

/**
 * Steinberg's "VST Compatible" and "ASIO Compatible" logos, as the usage guidelines in the VST 3 and
 * ASIO SDKs ask for: the unaltered official artwork (src/assets/logos), at least 15 × 10 mm, with the
 * trademark attribution next to it, in the About box and in every dialog that configures ASIO.
 */
export const VST_TRADEMARK = 'VST is a registered trademark of Steinberg Media Technologies GmbH.';
export const ASIO_TRADEMARK = 'ASIO is a registered trademark of Steinberg Media Technologies GmbH.';

export function VstLogo() {
  return (
    <figure className="brand-logo vst">
      <img src={vstLogo} alt="VST Compatible" width={84} height={54} draggable={false} />
      <figcaption>{VST_TRADEMARK}</figcaption>
    </figure>
  );
}

export function AsioLogo() {
  return (
    <figure className="brand-logo asio">
      <img src={asioLogo} alt="ASIO Compatible" width={84} height={54} draggable={false} />
      <figcaption>{ASIO_TRADEMARK}</figcaption>
    </figure>
  );
}
