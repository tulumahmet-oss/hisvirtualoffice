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
  const FURNITURE_CATALOG = {
    desk: { label: 'Çalışma istasyonu', width: 114, depth: 48, height: 29, blocks: true, footprint: { x: -57.5, y: -21, width: 115, height: 45 }, seatOffset: { x: -1, y: 30, direction: 'up' } },
    meetingTable: { label: 'Toplantı masası', width: 142, depth: 60, height: 28, blocks: true, footprint: { x: -70, y: -27, width: 140, height: 56 } },
    coffeeTable: { label: 'Orta sehpa', width: 142, depth: 58, height: 25, blocks: true, footprint: { x: -70, y: -24, width: 140, height: 48 } },
    plant: { label: 'Bitki', width: 50, depth: 50, height: 96, blocks: true, footprint: { x: -10, y: 3, width: 20, height: 17 } },
    shelf: { label: 'Kitaplık', width: 72, depth: 36, height: 84, blocks: false },
    cabinet: { label: 'Dosya dolabı', width: 48, depth: 42, height: 63, blocks: false },
    lamp: { label: 'Masa lambası', width: 19, depth: 19, height: 36, blocks: false },
    monitor: { label: 'Monitör', width: 40, depth: 16, height: 28, blocks: false },
    keyboard: { label: 'Klavye', width: 25, depth: 10, height: 3, blocks: false },
    rug: { label: 'Halı', width: 185, depth: 225, height: 1, blocks: false }
  };
  const FURNITURE = [];
  const DEFAULT_FURNITURE = [];
  const deskColumns = [88, 270, 452, 634, 816];
  const deskRows = [170, 315, 612, 772];
  let defaultDeskIndex = 0;
  for (const y of deskRows) {
    for (const x of deskColumns) {
      defaultDeskIndex += 1;
      DEFAULT_FURNITURE.push({
        id: `desk-${defaultDeskIndex}`,
        type: 'desk',
        x: x + 57,
        y: y + 24,
        rotation: 0,
        scale: 1,
        seatId: `seat-${defaultDeskIndex}`
      });
      if ((defaultDeskIndex - 1) % 5 === 0) {
        DEFAULT_FURNITURE.push({
          id: `lamp-${defaultDeskIndex}`,
          type: 'lamp',
          x: x + 18,
          y: y + 18,
          rotation: 0,
          scale: 1
        });
      }
    }
  }
  for (const room of ROOMS) {
    const centerX = room.x + room.width / 2;
    const centerY = room.y + room.height / 2 + 12;
    DEFAULT_FURNITURE.push(
      { id: `meeting-table-${room.id}`, type: 'meetingTable', x: centerX, y: centerY, rotation: 0, scale: 1 },
      { id: `room-shelf-${room.id}`, type: 'shelf', x: room.x + 32, y: room.y + 112, rotation: 0, scale: 1 },
      { id: `room-rug-${room.id}`, type: 'rug', x: centerX, y: centerY + 3, rotation: 0, scale: 1 }
    );
    DEFAULT_FURNITURE.push({
      id: `room-plant-${room.id}`,
      type: 'plant',
      x: room.x + 28,
      y: room.y + room.height - 35,
      rotation: 0,
      scale: 0.8
    });
  }
  DEFAULT_FURNITURE.push(
    { id: 'coffee-table-1', type: 'coffeeTable', x: 508, y: 478, rotation: 0, scale: 1 },
    { id: 'cabinet-1', type: 'cabinet', x: 854, y: 92, rotation: 0, scale: 1 },
    { id: 'shelf-1', type: 'shelf', x: 886, y: 744, rotation: 0, scale: 1 },
    { id: 'plant-1', type: 'plant', x: 390, y: 428, rotation: 0, scale: 0.9 },
    { id: 'plant-2', type: 'plant', x: 625, y: 543, rotation: 0, scale: 0.9 },
    { id: 'plant-3', type: 'plant', x: 45, y: 205, rotation: 0, scale: 1.15 },
    { id: 'plant-4', type: 'plant', x: 950, y: 280, rotation: 0, scale: 1.15 },
    { id: 'plant-5', type: 'plant', x: 46, y: 825, rotation: 0, scale: 1.1 }
  );
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
  const FIXED_OBSTACLES = [];
  const FIXED_SEATS = [];

  function addChair(x, y, direction, id) {
    FIXED_SEATS.push({ id, x, y, direction });
    FIXED_OBSTACLES.push({ x: x - 12, y: y - 2, width: 24, height: 22 });
  }

  addChair(418, 461, 'right', 'seat-21');
  addChair(598, 461, 'left', 'seat-22');
  addChair(458, 528, 'up', 'seat-23');
  addChair(558, 528, 'up', 'seat-24');
  FIXED_OBSTACLES.push({ x: 914, y: 378, width: 53, height: 91 });

  let fixedSeatIndex = 25;
  for (const room of ROOMS) {
    const centerX = room.x + room.width / 2;
    const centerY = room.y + room.height / 2 + 12;
    FIXED_OBSTACLES.push({ x: centerX - 36, y: room.y + 22, width: 72, height: 10 });
    addChair(centerX - 88, centerY - 8, 'right', `seat-${fixedSeatIndex++}`);
    addChair(centerX + 88, centerY - 8, 'left', `seat-${fixedSeatIndex++}`);
    addChair(centerX - 42, centerY + 45, 'up', `seat-${fixedSeatIndex++}`);
    addChair(centerX + 42, centerY + 45, 'up', `seat-${fixedSeatIndex++}`);
  }

  function normalizeFurnitureLayout(items) {
    if (!Array.isArray(items) || items.length > 100) return null;
    const ids = new Set();
    const seatIds = new Set(FIXED_SEATS.map((seat) => seat.id));
    const normalized = [];
    for (const item of items) {
      if (!item || typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(item.id) ||
          ids.has(item.id) || !Object.prototype.hasOwnProperty.call(FURNITURE_CATALOG, item.type)) return null;
      const x = Number(item.x);
      const y = Number(item.y);
      const scale = Number(item.scale ?? 1);
      const rotation = Number(item.rotation ?? 0);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(scale) ||
          !Number.isFinite(rotation) || scale < 0.6 || scale > 1.5) return null;
      const definition = FURNITURE_CATALOG[item.type];
      const rotatedWidth = (Math.abs(Math.cos(rotation)) * definition.width +
        Math.abs(Math.sin(rotation)) * definition.depth) * scale;
      const rotatedDepth = (Math.abs(Math.sin(rotation)) * definition.width +
        Math.abs(Math.cos(rotation)) * definition.depth) * scale;
      if (x - rotatedWidth / 2 < 0 || y - rotatedDepth / 2 < 0 ||
          x + rotatedWidth / 2 > WORLD.width || y + rotatedDepth / 2 > WORLD.height) return null;
      const angle = ((Math.round(rotation / (Math.PI / 2)) % 4) + 4) % 4 * (Math.PI / 2);
      const normalizedItem = {
        id: item.id,
        type: item.type,
        x,
        y,
        rotation: angle,
        scale
      };
      if (item.type === 'desk') {
        const seatId = typeof item.seatId === 'string' &&
          /^[a-zA-Z0-9_-]{1,90}$/.test(item.seatId)
          ? item.seatId
          : `seat-${item.id}`;
        if (seatIds.has(seatId)) return null;
        seatIds.add(seatId);
        normalizedItem.seatId = seatId;
      }
      ids.add(item.id);
      normalized.push(normalizedItem);
    }
    return normalized;
  }

  function furnitureCollisionRects(item) {
    const definition = FURNITURE_CATALOG[item.type];
    if (!definition.blocks) return [];
    const cosine = Math.cos(item.rotation);
    const sine = Math.sin(item.rotation);
    const rotateRect = (centerX, centerY, width, height) => {
      const rotatedCenterX = cosine * centerX + sine * centerY;
      const rotatedCenterY = -sine * centerX + cosine * centerY;
      const rotatedWidth = Math.abs(cosine) * width + Math.abs(sine) * height;
      const rotatedHeight = Math.abs(sine) * width + Math.abs(cosine) * height;
      return {
        x: item.x + rotatedCenterX - rotatedWidth / 2,
        y: item.y + rotatedCenterY - rotatedHeight / 2,
        width: rotatedWidth,
        height: rotatedHeight
      };
    };
    const footprint = definition.footprint;
    const rects = [rotateRect(
      (footprint.x + footprint.width / 2) * item.scale,
      (footprint.y + footprint.height / 2) * item.scale,
      footprint.width * item.scale,
      footprint.height * item.scale
    )];
    if (item.type === 'desk') {
      const seat = definition.seatOffset;
      const seatOffsetX = seat.x * item.scale;
      const seatOffsetY = seat.y * item.scale;
      const seatX = item.x + cosine * seatOffsetX + sine * seatOffsetY;
      const seatY = item.y - sine * seatOffsetX + cosine * seatOffsetY;
      const chairCenterX = sine * 9 * item.scale;
      const chairCenterY = cosine * 9 * item.scale;
      const chairWidth = Math.abs(cosine) * 24 + Math.abs(sine) * 22;
      const chairHeight = Math.abs(sine) * 24 + Math.abs(cosine) * 22;
      rects.push({
        x: seatX + chairCenterX - chairWidth / 2,
        y: seatY + chairCenterY - chairHeight / 2,
        width: chairWidth,
        height: chairHeight
      });
    }
    return rects;
  }

  function rectanglesIntersect(first, second) {
    return first.x < second.x + second.width &&
      first.x + first.width > second.x &&
      first.y < second.y + second.height &&
      first.y + first.height > second.y;
  }

  function isFurnitureLayoutValid(items) {
    const normalized = normalizeFurnitureLayout(items);
    if (!normalized) return false;
    const fixedObstacles = [...WALLS, ...FIXED_OBSTACLES, ...DOORS.map((door) => door.opening)];
    const protectedAreas = [
      ...DOORS.map((door) => door.opening),
      { x: 914, y: 378, width: 53, height: 91 },
      ...ROOMS.map((room) => ({
        x: room.x + room.width / 2 - 36,
        y: room.y + 22,
        width: 72,
        height: 10
      }))
    ];
    const placed = [];
    for (const item of normalized) {
      const definition = FURNITURE_CATALOG[item.type];
      const cosine = Math.cos(item.rotation);
      const sine = Math.sin(item.rotation);
      const bounds = {
        x: item.x - (Math.abs(cosine) * definition.width + Math.abs(sine) * definition.depth) * item.scale / 2,
        y: item.y - (Math.abs(sine) * definition.width + Math.abs(cosine) * definition.depth) * item.scale / 2,
        width: (Math.abs(cosine) * definition.width + Math.abs(sine) * definition.depth) * item.scale,
        height: (Math.abs(sine) * definition.width + Math.abs(cosine) * definition.depth) * item.scale
      };
      if (protectedAreas.some((area) => rectanglesIntersect(bounds, area))) return false;
      const rects = furnitureCollisionRects(item);
      if (rects.some((rect) =>
        fixedObstacles.some((obstacle) => rectanglesIntersect(rect, obstacle)) ||
        placed.some((other) => rectanglesIntersect(rect, other))
      )) return false;
      placed.push(...rects);
    }
    return true;
  }

  function setFurnitureLayout(items) {
    const normalized = normalizeFurnitureLayout(items);
    if (!normalized) throw new Error('Ofis yerleşimi geçersiz.');
    FURNITURE.splice(0, FURNITURE.length, ...normalized);
    const furnitureObstacles = [];
    const deskSeats = [];
    for (const item of FURNITURE) {
      const definition = FURNITURE_CATALOG[item.type];
      const cosine = Math.cos(item.rotation);
      const sine = Math.sin(item.rotation);
      if (definition.blocks) {
        const footprint = definition.footprint;
        const width = footprint.width * item.scale;
        const height = footprint.height * item.scale;
        const centerOffsetX = (footprint.x + footprint.width / 2) * item.scale;
        const centerOffsetY = (footprint.y + footprint.height / 2) * item.scale;
        const rotatedCenterX = cosine * centerOffsetX + sine * centerOffsetY;
        const rotatedCenterY = -sine * centerOffsetX + cosine * centerOffsetY;
        const rotatedWidth = Math.abs(cosine) * width + Math.abs(sine) * height;
        const rotatedHeight = Math.abs(sine) * width + Math.abs(cosine) * height;
        furnitureObstacles.push({
          x: item.x + rotatedCenterX - rotatedWidth / 2,
          y: item.y + rotatedCenterY - rotatedHeight / 2,
          width: rotatedWidth,
          height: rotatedHeight
        });
      }
      if (item.type === 'desk') {
        const offset = definition.seatOffset;
        const offsetX = offset.x * item.scale;
        const offsetY = offset.y * item.scale;
        const seat = {
          id: item.seatId,
          x: item.x + cosine * offsetX + sine * offsetY,
          y: item.y - sine * offsetX + cosine * offsetY,
          direction: ['up', 'left', 'down', 'right'][
            ((Math.round(item.rotation / (Math.PI / 2)) % 4) + 4) % 4
          ]
        };
        deskSeats.push(seat);
        const seatWidth = Math.abs(cosine) * 24 + Math.abs(sine) * 22;
        const seatHeight = Math.abs(sine) * 24 + Math.abs(cosine) * 22;
        const chairCenterX = sine * 9 * item.scale;
        const chairCenterY = cosine * 9 * item.scale;
        furnitureObstacles.push({
          x: seat.x + chairCenterX - seatWidth / 2,
          y: seat.y + chairCenterY - seatHeight / 2,
          width: seatWidth,
          height: seatHeight
        });
      }
    }
    OBSTACLES.splice(0, OBSTACLES.length, ...FIXED_OBSTACLES, ...furnitureObstacles);
    SEATS.splice(0, SEATS.length, ...deskSeats, ...FIXED_SEATS);
    return FURNITURE;
  }
  setFurnitureLayout(DEFAULT_FURNITURE);

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
    WORLD, OFFICE, ROOMS, COFFEE_STATION, PLAYER_RADIUS, DOORS, WALLS,
    OBSTACLES, SEATS, FURNITURE_CATALOG, FURNITURE, DEFAULT_FURNITURE,
    normalizeFurnitureLayout, isFurnitureLayoutValid, setFurnitureLayout, isBlocked, slide
  };
}));
