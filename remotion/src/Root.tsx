import { Composition } from "remotion";
import { ShortFormTemplate } from "./templates/ShortFormTemplate";
import { PromoTemplate } from "./templates/PromoTemplate";
import { SquareTemplate } from "./templates/SquareTemplate";

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="short-form"
      component={ShortFormTemplate}
      durationInFrames={450}
      fps={30}
      width={1080}
      height={1920}
    />
    <Composition
      id="promo"
      component={PromoTemplate}
      durationInFrames={450}
      fps={30}
      width={1920}
      height={1080}
    />
    <Composition
      id="square"
      component={SquareTemplate}
      durationInFrames={450}
      fps={30}
      width={1080}
      height={1080}
    />
  </>
);
