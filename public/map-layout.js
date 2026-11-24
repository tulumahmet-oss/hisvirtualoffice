(function (root, factory) {
  const layout = factory();
  if (typeof module === 'object' && module.exports) module.exports = layout;
  else root.GatherMapLayout = layout;
}(globalThis, function () {
  const WORLD = { width: 1600, height: 900 };
  const OFFICE = { x: 20, y: 20, width: 980, height: 860 };
  const ROOMS = [
    { id: 1, name: 'Toplantı Odası 1', x: 1020, y: 20, width: 270, height: 410 },
    { id: 2, name: 'Toplantı Odası 2', x: 1310, y: 20, width: 270, height: 410 },
    { id: 3, name: 'Toplantı Odası 3', x: 1020, y: 470, width: 270, height: 410 },
    { id: 4, name: 'Toplantı Odası 4', x: 1310, y: 470, width: 270, height: 410 }
  ];
  const COFFEE_STATION = { id: 'coffee-station', x: 940, y: 420, interactionRadius: 58 };
  const PLAYER_RADIUS = 11;
  const DOORS = [
    { id: 'office-room-1', roomId: 1, orientation: 'vertical', x: 1010, y: 200, opening: { x: 990, y: 176, width: 42, height: 48 } },
    { id: 'room-1-room-2', roomId: 2, orientation: 'vertical', x: 1300, y: 200, opening: { x: 1278, y: 176, width: 44, height: 48 } },
    { id: 'office-room-3', roomId: 3, orientation: 'vertical', x: 1010, y: 650, opening: { x: 990, y: 626, width: 42, height: 48 } },
    { id: 'room-3-room-4', roomId: 4, orientation: 'vertical', x: 1300, y: 650, opening: { x: 1278, y: 626, width: 44, height: 48 } },
    { id: 'room-1-room-3', roomId: 3, orientation: 'horizontal', x: 1155, y: 450, opening: { x: 1131, y: 422, width: 48, height: 56 } },
    { id: 'room-2-room-4', roomId: 4, orientation: 'horizontal', x: 1445, y: 450, opening: { x: 1421, y: 422, width: 48, height: 56 } }
  ];

  function verticalSegments(x, y, width, height, gaps, gapSize) {
    const segments = [];
    let cursor = y;
    for (const center of gaps.slice().sort((a, b) => a - b)) {
      const gapStart = Math.max(y, center - gapSize / 2);
      const gapEnd = Math.min(y + height, center + gapSize / 2);
      if (gapStart > cursor) segments.push({ x, y: cursor, width, height: gapStart - cursor });
      cursor = Math.max(cursor, gapEnd);
    }
    if (cursor < y + height) segments.push({ x, y: cursor, width, height: y + height - cursor });
    return segments;
  }

  function horizontalSegments(x, y, width, height, gaps, gapSize) {
    const segments = [];
    let cursor = x;
    for (const center of gaps.slice().sort((a, b) => a - b)) {
      const gapStart = Math.max(x, center - gapSize / 2);
      const gapEnd = Math.min(x + width, center + gapSize / 2);
      if (gapStart > cursor) segments.push({ x: cursor, y, width: gapStart - cursor, height });
      cursor = Math.max(cursor, gapEnd);
    }
    if (cursor < x + width) segments.push({ x: cursor, y, width: x + width - cursor, height });
    return segments;
  }

  const WALLS = [
    { x: OFFICE.x, y: OFFICE.y, width: OFFICE.width, height: 8 },
    { x: OFFICE.x, y: OFFICE.y, width: 8, height: OFFICE.height },
    { x: OFFICE.x, y: OFFICE.y + OFFICE.height - 8, width: OFFICE.width, height: 8 },
    ...verticalSegments(992, 20, 28, 860, [200, 650], 48),
    ...verticalSegments(1020, 20, 8, 410, [200], 48),
    ...verticalSegments(1282, 20, 8, 410, [200], 48),
    ...verticalSegments(1310, 20, 8, 410, [200], 48),
    ...verticalSegments(1572, 20, 8, 410, [], 48),
    ...verticalSegments(1020, 470, 8, 410, [650], 48),
    ...verticalSegments(1282, 470, 8, 410, [650], 48),
    ...verticalSegments(1310, 470, 8, 410, [650], 48),
    ...verticalSegments(1572, 470, 8, 410, [], 48),
    ...verticalSegments(1290, 20, 20, 860, [200, 650], 48),
    ...horizontalSegments(1020, 20, 270, 8, [], 48),
    ...horizontalSegments(1310, 20, 270, 8, [], 48),
    ...horizontalSegments(1020, 422, 270, 8, [1155], 48),
    ...horizontalSegments(1310, 422, 270, 8, [1445], 48),
    ...horizontalSegments(1020, 470, 270, 8, [1155], 48),
    ...horizontalSegments(1310, 470, 270, 8, [1445], 48),
    ...horizontalSegments(1020, 872, 270, 8, [], 48),
    ...horizontalSegments(1310, 872, 270, 8, [], 48),
    ...horizontalSegments(1020, 430, 560, 40, [1155, 1445], 48)
  ];

  const OBSTACLES = [];
  const SEATS = [];
  const deskColumns = [88, 270, 452, 634, 816];
  const deskRows = [170, 315, 612, 772];
  for (const y of deskRows) {
    for (const x of deskColumns) {
      OBSTACLES.push({ x, y: y + 3, width: 115, height: 45 });
      addChair(x + 56, y + 54, 'up');
    }
  }

  function addChair(x, y, direction = 'up') {
    const id = `seat-${SEATS.length + 1}`;
    SEATS.push({ id, x, y, direction });
    OBSTACLES.push({ x: x - 12, y: y - 2, width: 24, height: 22 });
  }

  function addPlant(x, y, scale) {
    OBSTACLES.push({
      x: x - 10 * scale,
      y: y + 3 * scale,
      width: 20 * scale,
      height: 17 * scale
    });
  }

  OBSTACLES.push({ x: 438, y: 454, width: 140, height: 48 });
  addChair(418, 461, 'right');
  addChair(598, 461, 'left');
  addChair(458, 528, 'up');
  addChair(558, 528, 'up');
  addPlant(390, 428, 0.9);
  addPlant(625, 543, 0.9);
  addPlant(45, 205, 1.15);
  addPlant(950, 280, 1.15);
  addPlant(46, 825, 1.1);
  OBSTACLES.push({ x: 914, y: 378, width: 53, height: 91 });

  for (const room of ROOMS) {
    const centerX = room.x + room.width / 2;
    const centerY = room.y + room.height / 2 + 12;
    OBSTACLES.push({ x: centerX - 36, y: room.y + 22, width: 72, height: 10 });
    OBSTACLES.push({ x: centerX - 70, y: centerY - 27, width: 140, height: 56 });
    addChair(centerX - 88, centerY - 8, 'right');
    addChair(centerX + 88, centerY - 8, 'left');
    addChair(centerX - 42, centerY + 45, 'up');
    addChair(centerX + 42, centerY + 45, 'up');
    addPlant(room.x + 28, room.y + room.height - 35, 0.8);
  }

  function circleIntersectsRect(x, y, radius, rect) {
    const nearestX = Math.max(rect.x, Math.min(x, rect.x + rect.width));
    const nearestY = Math.max(rect.y, Math.min(y, rect.y + rect.height));
    const dx = x - nearestX;
    const dy = y - nearestY;
    return dx * dx + dy * dy < radius * radius;
  }

  function isBlocked(x, y, radius = PLAYER_RADIUS) {
    if (x < radius || y < radius || x > WORLD.width - radius || y > WORLD.height - radius) return true;
    return WALLS.some((wall) => circleIntersectsRect(x, y, radius, wall)) ||
      OBSTACLES.some((obstacle) => circleIntersectsRect(x, y, radius, obstacle));
  }

  function slide(x, y, dx, dy, blocked = isBlocked) {
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 4));
    const stepX = dx / steps;
    const stepY = dy / steps;
    for (let step = 0; step < steps; step += 1) {
      if (!blocked(x + stepX, y)) x += stepX;
      if (!blocked(x, y + stepY)) y += stepY;
    }
    return { x, y };
  }

  return {
    WORLD, OFFICE, ROOMS, COFFEE_STATION, PLAYER_RADIUS, DOORS, WALLS, OBSTACLES, SEATS, isBlocked, slide
  };
}));
