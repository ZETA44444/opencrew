export const SHAPES = ['circle', 'square', 'diamond', 'hexagon', 'triangle'];
export const COLORS = ['#e5e5e5', '#7dd3fc', '#fca5a5', '#86efac', '#fcd34d', '#c4b5fd', '#f9a8d4', '#fdba74'];

export default function Avatar({ bot, size = 32 }) {
  return (
    <div className={`avatar shape-${bot.shape || 'circle'}`} style={{ width: size, height: size, background: bot.color, fontSize: size * 0.42 }}>
      <span>{(bot.name || '?').slice(0, 1).toUpperCase()}</span>
    </div>
  );
}

// Overlapping avatars for a group chat.
export function GroupAvatar({ members, size = 32 }) {
  const shown = members.slice(0, 3);
  const small = Math.round(size * 0.62);
  return (
    <div className="group-avatar" style={{ width: size, height: size }}>
      {shown.map((b, i) => (
        <div key={b.id} style={{ position: 'absolute', left: i * (size - small) / Math.max(1, shown.length - 1), top: i % 2 ? size - small : 0 }}>
          <Avatar bot={b} size={small} />
        </div>
      ))}
    </div>
  );
}
