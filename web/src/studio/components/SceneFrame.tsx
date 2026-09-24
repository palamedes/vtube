import '../../shared/scene.css';
import { sceneCss, VIEW_NAMES, type ViewId } from '../../shared/scene';
import { backgroundImage } from '../../shared/sceneDraw';
import { useStudio } from '../useStudio';
import { CharacterView } from './CharacterView';

/** One output format, laid out exactly as it will export: background, character, headline. */
export function SceneFrame({ view }: { view: ViewId }) {
  const { settings } = useStudio();
  const scene = settings.scene;
  const css = sceneCss(scene[view], view);
  const background = backgroundImage(scene, view);

  return (
    <div
      className={`frame ${view} scene-frame ${background ? '' : 'bg-checker'}`}
      style={background ? { backgroundImage: `url(${background})` } : undefined}
    >
      <div className="scene-character" style={css.character}>
        <CharacterView characterId={scene.character} />
      </div>
      {scene[view].headline.show && (
        <div
          className="scene-headline"
          style={{
            left: css.headline.left,
            top: css.headline.top,
            width: css.headline.width,
            padding: css.headline.padding,
            borderLeftWidth: css.headline.borderLeftWidth,
            fontSize: css.headline.fontSize,
          }}
        >
          {scene.kicker.trim() && (
            <span className="kicker" style={{ fontSize: css.headline.kickerFontSize }}>
              {scene.kicker}
            </span>
          )}
          <span className="headline">{scene.headline}</span>
        </div>
      )}
      <span className="frame-label">{VIEW_NAMES[view]}</span>
    </div>
  );
}
