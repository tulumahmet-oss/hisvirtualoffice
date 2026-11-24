'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const layout = require('../public/map-layout');

test.afterEach(() => {
  layout.setFurnitureLayout(layout.DEFAULT_FURNITURE);
});

test('default office layout has editable workstations and seats', () => {
  assert.equal(layout.FURNITURE.filter((item) => item.type === 'desk').length, 20);
  assert.equal(layout.SEATS.length, 40);
  assert.ok(layout.normalizeFurnitureLayout(layout.FURNITURE));
  assert.equal(layout.isFurnitureLayoutValid(layout.FURNITURE), true);
});

test('moving a workstation moves its linked seat and blocking obstacle', () => {
  const furniture = layout.FURNITURE.map((item) => ({ ...item }));
  const desk = furniture.find((item) => item.id === 'desk-1');
  desk.x += 100;

  layout.setFurnitureLayout(furniture);

  const seat = layout.SEATS.find((item) => item.id === 'seat-1');
  assert.deepEqual({ x: seat.x, y: seat.y }, { x: 244, y: 224 });
  assert.ok(layout.OBSTACLES.some((item) =>
    Math.abs(item.x - 187.5) < 0.001 && Math.abs(item.y - 173) < 0.001
  ));
});

test('rotating a workstation rotates its seat location and facing', () => {
  const furniture = layout.FURNITURE.map((item) => ({ ...item }));
  furniture.find((item) => item.id === 'desk-1').rotation = Math.PI / 2;

  layout.setFurnitureLayout(furniture);

  const seat = layout.SEATS.find((item) => item.id === 'seat-1');
  assert.ok(Math.abs(seat.x - 175) < 0.001);
  assert.ok(Math.abs(seat.y - 195) < 0.001);
  assert.equal(seat.direction, 'left');
});

test('invalid furniture type, duplicate IDs, and out-of-bounds items are rejected', () => {
  const furniture = layout.DEFAULT_FURNITURE.map((item) => ({ ...item }));

  assert.equal(layout.normalizeFurnitureLayout([
    ...furniture,
    { id: 'invalid', type: 'coffeeMachine', x: 400, y: 400 }
  ]), null);
  assert.equal(layout.normalizeFurnitureLayout([
    ...furniture,
    { ...furniture[0], type: 'plant', x: 500, y: 500 }
  ]), null);
  assert.equal(layout.normalizeFurnitureLayout([
    ...furniture,
    { id: 'outside', type: 'plant', x: -40, y: 400 }
  ]), null);
});

test('collidable furniture cannot overlap another item, wall, or doorway', () => {
  const overlappingDesks = layout.DEFAULT_FURNITURE.map((item) => ({ ...item }));
  const firstDesk = overlappingDesks.find((item) => item.id === 'desk-1');
  overlappingDesks.find((item) => item.id === 'desk-2').x = firstDesk.x + 10;
  assert.equal(layout.isFurnitureLayoutValid(overlappingDesks), false);

  const wallPlant = layout.DEFAULT_FURNITURE.map((item) => ({ ...item }));
  wallPlant.push({ id: 'wall-plant', type: 'plant', x: 998, y: 300, rotation: 0, scale: 1 });
  assert.equal(layout.isFurnitureLayoutValid(wallPlant), false);

  const doorwayPlant = layout.DEFAULT_FURNITURE.map((item) => ({ ...item }));
  doorwayPlant.push({ id: 'doorway-plant', type: 'plant', x: 1010, y: 200, rotation: 0, scale: 1 });
  assert.equal(layout.isFurnitureLayoutValid(doorwayPlant), false);
});
