import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const CHARACTER_ASSETS = {
  'business-man': '/assets/characters3d/business-man.glb',
  'man-in-suit': '/assets/characters3d/man-in-suit.glb',
  'woman-dress': '/assets/characters3d/woman-dress.glb',
  'woman-casual': '/assets/characters3d/woman-casual.glb',
  woman: '/assets/characters3d/woman.glb',
  worker: '/assets/characters3d/worker.glb'
};

const FURNITURE_ASSETS = {
  desk: 'Office_Desk_1.fbx',
  meetingTable: 'Office_Desk_2.fbx',
  chair: 'Chair_A.fbx',
  chairAlternate: 'Chair_B.fbx',
  monitor: 'Computer_Monitor.fbx',
  keyboard: 'Computer_Keyboard.fbx',
  shelf: 'Bookshelf.fbx',
  coffeeMachine: 'CoffeeMachine.fbx',
  coffeeTable: 'CoffeeTable.fbx',
  door: 'Door_A.fbx',
  doorFrame: 'Door_Frame.fbx',
  plant: 'Nature_Deco_Bamboo1.fbx',
  rug: 'Rug_A.fbx',
  cabinet: 'FileCabinet_Standard.fbx',
  lamp: 'Lamp_1.fbx'
};

const DEFAULT_CHARACTER = {
  modelId: 'business-man',
  bodyColor: '#4b89a5',
  skinColor: '#e8b58f',
  hairColor: '#49332e'
};

function makeFloorTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  context.fillStyle = '#d7bd98';
  context.fillRect(0, 0, canvas.width, canvas.height);
  for (let row = 0; row < 8; row += 1) {
    const y = row * 32;
    context.fillStyle = row % 2 ? '#dfc7a5' : '#d9c09d';
    context.fillRect(0, y + 1, 256, 30);
    context.strokeStyle = '#a98560';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(0, y + 31.5);
    context.lineTo(256, y + 31.5);
    context.stroke();
    const seam = row % 2 ? 48 : 176;
    context.beginPath();
    context.moveTo(seam + 0.5, y);
    context.lineTo(seam + 0.5, y + 32);
    context.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(6, 4);
  return texture;
}

function makeLabel(text, width = 190) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 96;
  const context = canvas.getContext('2d');
  context.fillStyle = '#25252be8';
  context.beginPath();
  context.roundRect(6, 6, 500, 84, 18);
  context.fill();
  context.fillStyle = '#fff8ed';
  context.font = 'bold 36px system-ui, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, 256, 49);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
  sprite.scale.set(width, width * 0.19, 1);
  return sprite;
}

function normalizedName(value) {
  return String(value || '').toLowerCase();
}

export class Office3DScene {
  constructor(container, overlayCanvas, layout, onError = () => {}) {
    this.container = container;
    this.overlayCanvas = overlayCanvas;
    this.layout = layout;
    this.onError = onError;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#e8c99e');
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.className = 'world-3d';
    this.container.prepend(this.renderer.domElement);

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 6000);
    this.camera.up.set(0, 1, 0);
    this.lookTarget = new THREE.Vector3();
    this.aspect = 1;
    this.zoomLevel = 1;
    this.panX = 0;
    this.panY = 0;
    this.elevation = THREE.MathUtils.degToRad(45);
    this.players = new Map();
    this.characterTemplates = new Map();
    this.furnitureTemplates = new Map();
    this.furnitureRoots = [];
    this.doorRoots = [];
    this.previewRenderer = null;
    this.previewScene = null;
    this.previewCamera = null;
    this.previewRoot = null;
    this.lastRenderAt = 0;
    this.initialized = false;

    this.addLighting();
    this.buildFloors();
    this.buildWalls();
    this.buildRoomLabels();
    this.resize(container.clientWidth, container.clientHeight, 1, 0, 0);
  }

  addLighting() {
    const hemisphere = new THREE.HemisphereLight(0xfff4e3, 0x757b80, 2.1);
    this.scene.add(hemisphere);
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
    sun.position.set(-280, 720, 440);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -1100;
    sun.shadow.camera.right = 1100;
    sun.shadow.camera.top = 750;
    sun.shadow.camera.bottom = -750;
    sun.shadow.bias = -0.0002;
    this.scene.add(sun);
  }

  addGroundPlane(x, z, width, depth, material, height = 0) {
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), material);
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(x + width / 2, height, z + depth / 2);
    plane.receiveShadow = true;
    this.scene.add(plane);
    return plane;
  }

  buildFloors() {
    const floorTexture = makeFloorTexture();
    const mainFloor = new THREE.MeshStandardMaterial({ map: floorTexture, roughness: 0.92 });
    this.addGroundPlane(0, 0, this.layout.WORLD.width, this.layout.WORLD.height, mainFloor, -1);

    const officeFloor = new THREE.MeshStandardMaterial({ color: '#e2c8a4', roughness: 0.95 });
    this.addGroundPlane(
      this.layout.OFFICE.x,
      this.layout.OFFICE.y,
      this.layout.OFFICE.width,
      this.layout.OFFICE.height,
      officeFloor,
      0
    );

    const carpet = new THREE.MeshStandardMaterial({ color: '#9da7a2', roughness: 1 });
    for (const room of this.layout.ROOMS) {
      this.addGroundPlane(room.x, room.y, room.width, room.height, carpet, 0.15);
      const rug = new THREE.Mesh(
        new THREE.PlaneGeometry(room.width - 34, room.height - 70),
        new THREE.MeshStandardMaterial({ color: '#6f817d', roughness: 1 })
      );
      rug.rotation.x = -Math.PI / 2;
      rug.position.set(room.x + room.width / 2, 0.22, room.y + room.height / 2 + 25);
      rug.receiveShadow = true;
      this.scene.add(rug);
    }

    const officeBorder = new THREE.Mesh(
      new THREE.BoxGeometry(this.layout.OFFICE.width, 3, 4),
      new THREE.MeshStandardMaterial({ color: '#9c754f', roughness: 0.85 })
    );
    officeBorder.position.set(
      this.layout.OFFICE.x + this.layout.OFFICE.width / 2,
      1.5,
      this.layout.OFFICE.y + this.layout.OFFICE.height - 2
    );
    this.scene.add(officeBorder);
  }

  buildWalls() {
    const wallMaterial = new THREE.MeshStandardMaterial({ color: '#d3b797', roughness: 0.9 });
    const trimMaterial = new THREE.MeshStandardMaterial({ color: '#8b6747', roughness: 0.82 });
    for (const wall of this.layout.WALLS) {
      const height = 48;
      const geometry = new THREE.BoxGeometry(wall.width, height, wall.height);
      const mesh = new THREE.Mesh(geometry, wallMaterial);
      mesh.position.set(wall.x + wall.width / 2, height / 2, wall.y + wall.height / 2);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);

      const trim = new THREE.Mesh(
        new THREE.BoxGeometry(wall.width + 2, 3, wall.height + 2),
        trimMaterial
      );
      trim.position.set(mesh.position.x, height + 1.5, mesh.position.z);
      trim.castShadow = true;
      this.scene.add(trim);
    }
  }

  buildRoomLabels() {
    const officeLabel = makeLabel('AÇIK OFİS', 180);
    officeLabel.position.set(132, 8, 94);
    this.scene.add(officeLabel);
    for (const room of this.layout.ROOMS) {
      const label = makeLabel(room.name, 205);
      label.position.set(room.x + room.width / 2, 8, room.y + 37);
      this.scene.add(label);
    }
  }

  async initialize() {
    if (this.initialized) return;
    const gltfLoader = new GLTFLoader();
    const fbxManager = new THREE.LoadingManager();
    fbxManager.setURLModifier((url) => {
      if (/^(data:|blob:)/i.test(url)) return url;
      const filename = decodeURIComponent(url.split(/[\\/]/).pop() || '');
      if (/\.(png|jpe?g)$/i.test(filename)) {
        return `/assets/textures/${encodeURIComponent(filename)}`;
      }
      return url;
    });
    const fbxLoader = new FBXLoader(fbxManager);

    const characterLoads = Object.entries(CHARACTER_ASSETS).map(async ([id, url]) => {
      try {
        const gltf = await gltfLoader.loadAsync(url);
        this.characterTemplates.set(id, { scene: gltf.scene, animations: gltf.animations });
      } catch (error) {
        this.onError(`Karakter modeli yüklenemedi (${id}): ${error.message}`);
      }
    });
    const furnitureLoads = Object.entries(FURNITURE_ASSETS).map(async ([id, filename]) => {
      try {
        const object = await fbxLoader.loadAsync(`/assets/models/${filename}`);
        this.furnitureTemplates.set(id, object);
      } catch (error) {
        this.onError(`Ofis modeli yüklenemedi (${filename}): ${error.message}`);
      }
    });
    await Promise.all([...characterLoads, ...furnitureLoads]);
    this.buildFurniture();
    this.buildDoors();
    this.initialized = true;
  }

  buildFurniture() {
    const deskColumns = [88, 270, 452, 634, 816];
    const deskRows = [170, 315, 612, 772];
    let deskIndex = 0;
    for (const z of deskRows) {
      for (const x of deskColumns) {
        this.addFurniture('desk', x + 57, z + 24, 114, 48, 29);
        this.addFurniture('monitor', x + 57, z + 10, 28, 14, 24, 31);
        this.addFurniture('keyboard', x + 57, z + 25, 25, 10, 3, 31);
        if (deskIndex % 5 === 0) {
          this.addFurniture('lamp', x + 18, z + 18, 19, 19, 36, 30);
        }
        deskIndex += 1;
      }
    }

    for (const seat of this.layout.SEATS) {
      const rotation = this.directionRotation(seat.direction);
      const useAlternate = seat.id.endsWith('2') || seat.id.endsWith('4');
      this.addFurniture(useAlternate ? 'chairAlternate' : 'chair', seat.x, seat.y, 26, 28, 39, 0, rotation);
    }

    for (const room of this.layout.ROOMS) {
      const centerX = room.x + room.width / 2;
      const centerZ = room.y + room.height / 2 + 12;
      this.addFurniture('meetingTable', centerX, centerZ, 142, 60, 28);
      this.addFurniture('monitor', centerX, room.y + 29, 68, 13, 28, 34);
      this.addFurniture('shelf', room.x + 32, room.y + 112, 62, 33, 75);
      this.addFurniture('rug', centerX, centerZ + 3, 185, 225, 1, 0.25, 0, 0.9);
    }

    this.addFurniture('coffeeTable', 508, 478, 142, 58, 25);
    this.addFurniture('coffeeMachine', this.layout.COFFEE_STATION.x, this.layout.COFFEE_STATION.y, 48, 48, 66);
    this.addFurniture('cabinet', 854, 92, 48, 42, 63);
    this.addFurniture('shelf', 886, 744, 90, 38, 95);
    for (const [x, z, width, height] of [
      [390, 428, 43, 82],
      [625, 543, 43, 82],
      [45, 205, 50, 96],
      [950, 280, 50, 96],
      [46, 825, 48, 92]
    ]) {
      this.addFurniture('plant', x, z, width, width, height);
    }
  }

  buildDoors() {
    for (const door of this.layout.DOORS) {
      const root = new THREE.Group();
      const base = door.orientation === 'vertical'
        ? new THREE.Vector3(door.x, 0, door.y - 22)
        : new THREE.Vector3(door.x - 22, 0, door.y);
      root.position.copy(base);
      this.scene.add(root);
      const width = 44;
      const height = 45;
      const depth = 5;
      const frame = this.createFurnitureObject('doorFrame', 48, 48, 50);
      if (frame) {
        frame.position.set(0, 0, 0);
        if (door.orientation === 'vertical') frame.rotation.y = -Math.PI / 2;
        root.add(frame);
      } else {
        const frameGroup = new THREE.Group();
        if (door.orientation === 'vertical') frameGroup.rotation.y = -Math.PI / 2;
        this.addDoorFrameFallback(frameGroup, width, height);
        root.add(frameGroup);
      }
      const hinge = new THREE.Group();
      root.add(hinge);
      const leaf = this.createFurnitureObject('door', width, depth, height);
      if (leaf) {
        leaf.position.set(
          door.orientation === 'vertical' ? 0 : width / 2,
          0,
          door.orientation === 'vertical' ? width / 2 : 0
        );
        if (door.orientation === 'vertical') leaf.rotation.y = -Math.PI / 2;
        hinge.add(leaf);
      } else {
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(width, height, depth),
          new THREE.MeshStandardMaterial({ color: '#80593b', roughness: 0.8 })
        );
        mesh.position.set(
          door.orientation === 'vertical' ? 0 : width / 2,
          height / 2,
          door.orientation === 'vertical' ? width / 2 : 0
        );
        if (door.orientation === 'vertical') mesh.rotation.y = -Math.PI / 2;
        mesh.castShadow = true;
        hinge.add(mesh);
      }
      this.doorRoots.push({ hinge, door });
    }
  }

  addDoorFrameFallback(parent, width, height) {
    const material = new THREE.MeshStandardMaterial({ color: '#6f5038', roughness: 0.82 });
    for (const x of [-width / 2, width / 2]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(4, height, 5), material);
      post.position.set(x, height / 2, 0);
      post.castShadow = true;
      parent.add(post);
    }
    const top = new THREE.Mesh(new THREE.BoxGeometry(width + 4, 4, 5), material);
    top.position.y = height;
    parent.add(top);
  }

  addFurniture(key, x, z, width, depth, height, y = 0, rotation = 0, opacity = 1) {
    const object = this.createFurnitureObject(key, width, depth, height);
    if (!object) {
      const fallback = this.makeFurnitureFallback(key, width, depth, height);
      fallback.position.set(x, y, z);
      fallback.rotation.y = rotation;
      this.scene.add(fallback);
      this.furnitureRoots.push(fallback);
      return fallback;
    }
    object.position.set(x, y, z);
    object.rotation.y = rotation;
    if (opacity < 1) {
      object.traverse((child) => {
        if (!child.isMesh) return;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of materials) {
          material.transparent = true;
          material.opacity = opacity;
        }
      });
    }
    this.scene.add(object);
    this.furnitureRoots.push(object);
    return object;
  }

  createFurnitureObject(key, width, depth, height) {
    const template = this.furnitureTemplates.get(key);
    if (!template) return null;
    const source = template.clone(true);
    source.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(source);
    const size = bounds.getSize(new THREE.Vector3());
    if (size.x <= 0 || size.y <= 0 || size.z <= 0) return null;
    source.scale.set(width / size.x, height / size.y, depth / size.z);
    source.position.set(
      -((bounds.min.x + bounds.max.x) / 2) * source.scale.x,
      -bounds.min.y * source.scale.y,
      -((bounds.min.z + bounds.max.z) / 2) * source.scale.z
    );
    source.traverse((child) => {
      if (!child.isMesh) return;
      child.castShadow = true;
      child.receiveShadow = true;
    });
    const wrapper = new THREE.Group();
    wrapper.add(source);
    return wrapper;
  }

  makeFurnitureFallback(key, width, depth, height) {
    const group = new THREE.Group();
    const brown = new THREE.MeshStandardMaterial({ color: '#9c704a', roughness: 0.82 });
    const dark = new THREE.MeshStandardMaterial({ color: '#41474d', roughness: 0.75 });
    const green = new THREE.MeshStandardMaterial({ color: '#43885d', roughness: 0.9 });
    const box = (w, h, d, x, y, z, material) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      return mesh;
    };

    if (key === 'chair' || key === 'chairAlternate') {
      box(width, 5, depth * 0.72, 0, height * 0.48, depth * 0.05, brown);
      box(width * 0.82, height * 0.48, 5, 0, height * 0.74, -depth * 0.39, dark);
      for (const x of [-width * 0.38, width * 0.38]) {
        for (const z of [-depth * 0.3, depth * 0.3]) box(3, height * 0.47, 3, x, height * 0.23, z, brown);
      }
    } else if (key === 'coffeeMachine') {
      box(width, height, depth, 0, height / 2, 0, dark);
      box(width * 0.7, height * 0.25, 3, 0, height * 0.72, depth / 2 + 1, new THREE.MeshStandardMaterial({ color: '#4e8ca8' }));
    } else if (key === 'plant') {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(3, 4, height * 0.58, 5), brown);
      trunk.position.y = height * 0.38;
      group.add(trunk);
      for (let index = 0; index < 5; index += 1) {
        const leaf = new THREE.Mesh(new THREE.ConeGeometry(width * 0.25, height * 0.34, 5), green);
        leaf.position.set(Math.sin(index * 2.1) * width * 0.2, height * (0.62 + (index % 2) * 0.12), Math.cos(index * 2.1) * depth * 0.2);
        leaf.rotation.z = Math.sin(index) * 0.42;
        group.add(leaf);
      }
    } else {
      box(width, Math.max(height * 0.12, 3), depth, 0, height * 0.76, 0, brown);
      for (const x of [-width * 0.42, width * 0.42]) {
        for (const z of [-depth * 0.38, depth * 0.38]) box(4, height * 0.72, 4, x, height * 0.36, z, dark);
      }
    }
    return group;
  }

  directionRotation(direction) {
    if (direction === 'up') return Math.PI;
    if (direction === 'left') return -Math.PI / 2;
    if (direction === 'right') return Math.PI / 2;
    return 0;
  }

  createFallbackAvatar(character) {
    const group = new THREE.Group();
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: character.bodyColor || DEFAULT_CHARACTER.bodyColor });
    const skinMaterial = new THREE.MeshStandardMaterial({ color: character.skinColor || DEFAULT_CHARACTER.skinColor });
    const hairMaterial = new THREE.MeshStandardMaterial({ color: character.hairColor || DEFAULT_CHARACTER.hairColor });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(7, 18, 3, 6), bodyMaterial);
    body.position.y = 18;
    body.castShadow = true;
    group.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(7.5, 8, 6), skinMaterial);
    head.position.y = 36;
    head.castShadow = true;
    group.add(head);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(7.9, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), hairMaterial);
    hair.position.y = 37;
    group.add(hair);
    return group;
  }

  modelClip(animations, keyword) {
    const target = normalizedName(keyword);
    return animations.find((clip) => {
      const name = normalizedName(clip.name);
      return name.endsWith(target) || name.endsWith(`_${target}`);
    });
  }

  retargetAnimationClip(clip, sourceRoot, targetRoot, positionScale) {
    const bonesByName = (root) => {
      const bones = new Map();
      root.traverse((node) => {
        if (node.isBone && !bones.has(node.name)) bones.set(node.name, node);
      });
      return bones;
    };
    const sourceBones = bonesByName(sourceRoot);
    const targetBones = bonesByName(targetRoot);
    const tracks = [];

    for (const track of clip.tracks) {
      const separator = track.name.lastIndexOf('.');
      if (separator < 1) continue;
      const boneName = track.name.slice(0, separator);
      const sourceBone = sourceBones.get(boneName);
      const targetBone = targetBones.get(boneName);
      if (!sourceBone || !targetBone) continue;

      if (track.ValueTypeName === 'quaternion') {
        const values = track.values.slice();
        const inverseSourceRest = sourceBone.quaternion.clone().invert();
        const targetRest = targetBone.quaternion.clone();
        for (let offset = 0; offset < values.length; offset += 4) {
          const rotation = new THREE.Quaternion().fromArray(values, offset);
          targetRest.clone()
            .multiply(inverseSourceRest.clone().multiply(rotation))
            .normalize()
            .toArray(values, offset);
        }
        tracks.push(new THREE.QuaternionKeyframeTrack(track.name, track.times, values));
      } else if (track.ValueTypeName === 'vector' && track.name.endsWith('.position')) {
        const values = track.values.slice();
        for (let offset = 0; offset < values.length; offset += 3) {
          values[offset] = targetBone.position.x +
            (values[offset] - sourceBone.position.x) * positionScale;
          values[offset + 1] = targetBone.position.y +
            (values[offset + 1] - sourceBone.position.y) * positionScale;
          values[offset + 2] = targetBone.position.z +
            (values[offset + 2] - sourceBone.position.z) * positionScale;
        }
        tracks.push(new THREE.VectorKeyframeTrack(track.name, track.times, values));
      }
    }

    if (!tracks.length) return null;
    return new THREE.AnimationClip(clip.name, clip.duration, tracks, clip.blendMode);
  }

  sittingClip(modelId, animations, avatar, targetScale) {
    const ownClip = this.modelClip(animations, 'sitting');
    if (ownClip) return ownClip;

    const fallbackModelId = modelId === 'business-man' || modelId === 'worker'
      ? 'man-in-suit'
      : 'woman-dress';
    const fallback = this.characterTemplates.get(fallbackModelId);
    const fallbackClip = this.modelClip(fallback?.animations || [], 'sitting');
    if (!fallback || !fallbackClip) return null;

    const sourceHeight = new THREE.Box3().setFromObject(fallback.scene).getSize(new THREE.Vector3()).y;
    const sourceScale = 54 / Math.max(sourceHeight, 0.001);
    return this.retargetAnimationClip(
      fallbackClip,
      fallback.scene,
      avatar,
      sourceScale / Math.max(targetScale, 0.001)
    );
  }

  applyCharacterColors(root, character) {
    root.traverse((child) => {
      if (!child.isMesh) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      const recolored = materials.map((source) => {
        const material = source.clone();
        const name = normalizedName(material.name);
        if (/skin|face/.test(name)) material.color.set(character.skinColor || DEFAULT_CHARACTER.skinColor);
        else if (/hair|eyebrow|brow|moustache|mustache|beard/.test(name)) {
          material.color.set(character.hairColor || DEFAULT_CHARACTER.hairColor);
        } else if (!/eye|white|black|shoe|detail|sock/.test(name)) {
          material.color.set(character.bodyColor || DEFAULT_CHARACTER.bodyColor);
        }
        return material;
      });
      child.material = Array.isArray(child.material) ? recolored : recolored[0];
      child.castShadow = true;
      child.receiveShadow = true;
    });
  }

  disposeAvatarMaterials(root) {
    root.traverse((child) => {
      if (!child.isMesh) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) material.dispose();
      if (['CapsuleGeometry', 'SphereGeometry', 'BoxGeometry', 'CylinderGeometry'].includes(child.geometry.type)) {
        child.geometry.dispose();
      }
    });
  }

  async buildPlayerModel(record, character) {
    const characterSignature = JSON.stringify(character);
    record.pendingCharacterSignature = characterSignature;
    const modelId = CHARACTER_ASSETS[character.modelId] ? character.modelId : 'business-man';
    if (!this.characterTemplates.has(modelId)) {
      const template = this.characterTemplates.get('business-man');
      if (!template) {
        record.pendingCharacterSignature = null;
        return;
      }
    }
    const template = this.characterTemplates.get(modelId);
    if (!template) {
      record.pendingCharacterSignature = null;
      return;
    }
    const avatar = SkeletonUtils.clone(template.scene);
    avatar.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(avatar);
    const size = bounds.getSize(new THREE.Vector3());
    const targetHeight = 54;
    const scale = targetHeight / Math.max(size.y, 0.001);
    avatar.scale.setScalar(scale);
    avatar.position.set(
      -((bounds.min.x + bounds.max.x) / 2) * scale,
      -bounds.min.y * scale,
      -((bounds.min.z + bounds.max.z) / 2) * scale
    );
    this.applyCharacterColors(avatar, character);
    this.disposeAvatarMaterials(record.avatarRoot);
    record.cup = null;
    record.avatarRoot.clear();
    record.avatarRoot.add(avatar);
    record.mixer = new THREE.AnimationMixer(avatar);
    record.actions = {};
    record.coffeeArmBones = {};
    avatar.traverse((child) => {
      if (!child.isBone) return;
      const name = normalizedName(child.name).replace(/[^a-z0-9]/g, '');
      if (name === 'upperarmr') record.coffeeArmBones.upper = child;
      else if (name === 'lowerarmr') record.coffeeArmBones.lower = child;
      else if (name === 'middlehandr' || name === 'lowerarmrend') record.coffeeArmBones.hand = child;
    });
    if (record.coffeeArmBones.lower && !record.coffeeArmBones.hand) {
      record.coffeeArmBones.hand = record.coffeeArmBones.lower.children.find((child) =>
        normalizedName(child.name).includes('end')
      ) || record.coffeeArmBones.lower;
    }
    record.coffeeArmRest = {
      upper: record.coffeeArmBones.upper?.quaternion.clone(),
      lower: record.coffeeArmBones.lower?.quaternion.clone()
    };
    const idle = this.modelClip(template.animations, 'idle') ||
      template.animations.find((clip) => normalizedName(clip.name).includes('idle'));
    const walk = this.modelClip(template.animations, 'walk');
    const sitting = this.sittingClip(modelId, template.animations, avatar, scale);
    const interact = this.modelClip(template.animations, 'interact');
    for (const [name, clip] of Object.entries({ idle, walk, sitting, interact })) {
      if (clip) record.actions[name] = record.mixer.clipAction(clip);
    }
    record.modelId = modelId;
    record.characterSignature = characterSignature;
    record.pendingCharacterSignature = null;
    record.currentAction = null;
    this.setPlayerAction(record, 'idle');
  }

  createPlayerRecord(player) {
    const root = new THREE.Group();
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(12, 16),
      new THREE.MeshBasicMaterial({ color: '#342c26', transparent: true, opacity: 0.22 })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.3;
    root.add(shadow);
    const avatarRoot = new THREE.Group();
    root.add(avatarRoot);
    avatarRoot.add(this.createFallbackAvatar(player.character || DEFAULT_CHARACTER));
    this.scene.add(root);
    const record = {
      root,
      avatarRoot,
      mixer: null,
      actions: {},
      currentAction: null,
      modelId: null,
      characterSignature: '',
      pendingCharacterSignature: JSON.stringify(player.character || DEFAULT_CHARACTER),
      coffeeArmRest: {},
      wasDrinkingCoffee: false,
      modelPromise: null,
      cup: null,
      coffeeStartedAt: 0
    };
    record.modelPromise = this.buildPlayerModel(record, player.character || DEFAULT_CHARACTER).catch((error) => {
      this.onError(`Karakter modeli hazırlanamadı: ${error.message}`);
    });
    return record;
  }

  setPlayerAction(record, name) {
    const action = record.actions[name] || record.actions.idle;
    if (!action || record.currentAction === action) return;
    if (name === 'sitting') {
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
    } else {
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.clampWhenFinished = false;
    }
    action.reset().fadeIn(0.18).play();
    if (record.currentAction) record.currentAction.fadeOut(0.18);
    record.currentAction = action;
  }

  rotateBoneTowardTarget(bone, end, target) {
    if (!bone || !end || bone === end) return;
    const bonePosition = bone.getWorldPosition(new THREE.Vector3());
    const endPosition = end.getWorldPosition(new THREE.Vector3());
    const from = endPosition.sub(bonePosition).normalize();
    const to = target.clone().sub(bonePosition).normalize();
    if (from.lengthSq() < 0.001 || to.lengthSq() < 0.001) return;

    const worldDelta = new THREE.Quaternion().setFromUnitVectors(from, to);
    const parentRotation = bone.parent.getWorldQuaternion(new THREE.Quaternion());
    const localDelta = parentRotation.clone().invert().multiply(worldDelta).multiply(parentRotation);
    bone.quaternion.premultiply(localDelta).normalize();
  }

  poseCoffeeArm(record) {
    const { upper, lower, hand } = record.coffeeArmBones || {};
    if (!upper || !lower || !hand) return;
    upper.quaternion.copy(record.coffeeArmRest.upper);
    lower.quaternion.copy(record.coffeeArmRest.lower);
    record.avatarRoot.updateWorldMatrix(true, true);
    const target = record.avatarRoot.localToWorld(new THREE.Vector3(-7, 41, 6));
    for (let iteration = 0; iteration < 3; iteration += 1) {
      this.rotateBoneTowardTarget(lower, hand, target);
      record.avatarRoot.updateWorldMatrix(true, true);
      this.rotateBoneTowardTarget(upper, hand, target);
      record.avatarRoot.updateWorldMatrix(true, true);
    }
  }

  updatePlayer(player, record, delta, now) {
    const character = player.character || DEFAULT_CHARACTER;
    const characterSignature = JSON.stringify(character);
    if (record.modelId && record.characterSignature !== characterSignature &&
        record.pendingCharacterSignature !== characterSignature) {
      record.pendingCharacterSignature = characterSignature;
      record.modelPromise = this.buildPlayerModel(record, character).catch((error) => {
        this.onError(`Karakter modeli değiştirilemedi: ${error.message}`);
      });
    }
    record.root.position.set(player.x, 0, player.y);
    record.root.rotation.y = this.directionRotation(player.direction);

    const isDrinking = Boolean(player.drinkingCoffee);
    const isSitting = Boolean(player.sitting);
    const actionName = isSitting ? 'sitting' : isDrinking ? 'interact' : player.moving ? 'walk' : 'idle';
    this.setPlayerAction(record, actionName);
    record.avatarRoot.position.y = 0;
    record.avatarRoot.scale.setScalar(1);
    if (record.mixer) record.mixer.update(delta);
    if (isDrinking) this.poseCoffeeArm(record);
    else if (record.wasDrinkingCoffee) {
      const { upper, lower } = record.coffeeArmBones || {};
      if (upper && record.coffeeArmRest.upper) upper.quaternion.copy(record.coffeeArmRest.upper);
      if (lower && record.coffeeArmRest.lower) lower.quaternion.copy(record.coffeeArmRest.lower);
    }
    record.wasDrinkingCoffee = isDrinking;
    record.root.scale.setScalar(1);

    if (isDrinking && !record.cup) {
      const cup = new THREE.Group();
      const mug = new THREE.Mesh(
        new THREE.CylinderGeometry(2.6, 2.2, 7, 8),
        new THREE.MeshStandardMaterial({ color: '#f0e2cc', roughness: 0.55 })
      );
      mug.position.y = 0;
      mug.castShadow = true;
      cup.add(mug);
      const coffee = new THREE.Mesh(
        new THREE.CircleGeometry(2.2, 8),
        new THREE.MeshBasicMaterial({ color: '#67412d' })
      );
      coffee.rotation.x = -Math.PI / 2;
      coffee.position.y = 3.55;
      cup.add(coffee);
      for (let index = 0; index < 3; index += 1) {
        const steam = new THREE.Mesh(
          new THREE.SphereGeometry(1.2, 6, 6),
          new THREE.MeshBasicMaterial({
            color: '#fff3df',
            transparent: true,
            opacity: 0.55,
            depthWrite: false
          })
        );
        steam.userData.phase = index / 3;
        cup.add(steam);
      }
      cup.position.set(-7, 41, 6);
      record.avatarRoot.add(cup);
      record.cup = cup;
      record.coffeeStartedAt = player.coffeeStartedAt || Date.now();
    } else if (!isDrinking && record.cup) {
      record.avatarRoot.remove(record.cup);
      record.cup.traverse((child) => {
        if (child.isMesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose());
          else child.material.dispose();
        }
      });
      record.cup = null;
    }
    if (record.cup) {
      const elapsed = (Date.now() - record.coffeeStartedAt) / 1000;
      record.cup.position.y = 41 + Math.sin(elapsed * 2.4) * 0.8;
      record.cup.rotation.x = 0.18 + Math.sin(elapsed * 1.8) * 0.08;
      for (const steam of record.cup.children.filter((child) => child.geometry?.type === 'SphereGeometry')) {
        const phase = (elapsed * 0.8 + steam.userData.phase) % 1;
        steam.position.set(Math.sin(elapsed * 2 + steam.userData.phase * 6) * 1.5, 6 + phase * 9, 0);
        steam.material.opacity = 0.55 * (1 - phase);
        steam.scale.setScalar(0.65 + phase * 0.65);
      }
    }
  }

  updateDoors(players, roomLocks, delta) {
    for (const item of this.doorRoots) {
      const { door, hinge } = item;
      const near = players.some((player) =>
        (!roomLocks[door.roomId] || player.roomId === door.roomId) &&
        Math.hypot(player.x - door.x, player.y - door.y) < 70
      );
      const target = near ? 1 : 0;
      item.progress = THREE.MathUtils.damp(item.progress || 0, target, 8, delta);
      const swing = door.orientation === 'vertical' ? -Math.PI / 2 : Math.PI / 2;
      hinge.rotation.y = swing * item.progress;
    }
  }

  resize(width, height, zoomLevel = this.zoomLevel, panX = this.panX, panY = this.panY) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.aspect = this.width / this.height;
    this.zoomLevel = zoomLevel;
    this.panX = panX;
    this.panY = panY;
    this.renderer.setSize(this.width, this.height, false);
    this.updateCamera();
  }

  updateCamera() {
    if (!this.width || !this.height) return;
    const world = this.layout.WORLD;
    const baseScale = Math.min(this.width / world.width, this.height / world.height);
    const viewHeight = this.height / (baseScale * this.zoomLevel);
    const viewWidth = viewHeight * this.aspect;
    this.camera.left = -viewWidth / 2;
    this.camera.right = viewWidth / 2;
    this.camera.top = viewHeight / 2;
    this.camera.bottom = -viewHeight / 2;
    const centerX = world.width / 2 - this.panX;
    const centerZ = world.height / 2 - this.panY / Math.cos(this.elevation);
    this.lookTarget.set(centerX, 0, centerZ);
    const distance = 2200;
    this.camera.position.set(
      centerX,
      distance * Math.sin(this.elevation),
      centerZ + distance * Math.cos(this.elevation)
    );
    this.camera.lookAt(this.lookTarget);
    this.camera.updateProjectionMatrix();
  }

  project(x, z, height = 0) {
    const point = new THREE.Vector3(x, height, z).project(this.camera);
    if (point.z < -1 || point.z > 1) return null;
    return {
      x: (point.x + 1) * this.width / 2 * (this.overlayCanvas.width / this.width),
      y: (1 - point.y) * this.height / 2 * (this.overlayCanvas.height / this.height)
    };
  }

  renderPreview(character, targets) {
    const modelId = CHARACTER_ASSETS[character.modelId] ? character.modelId : 'business-man';
    const template = this.characterTemplates.get(modelId);
    if (!template) return false;
    if (!this.previewRenderer) {
      this.previewScene = new THREE.Scene();
      this.previewScene.background = new THREE.Color('#efd3ad');
      this.previewRenderer = new THREE.WebGLRenderer({
        canvas: document.createElement('canvas'),
        antialias: true,
        preserveDrawingBuffer: true
      });
      this.previewRenderer.setPixelRatio(1);
      this.previewRenderer.setSize(96, 96, false);
      this.previewRenderer.outputColorSpace = THREE.SRGBColorSpace;
      this.previewScene.add(new THREE.HemisphereLight(0xfff6e8, 0x7d7772, 2.4));
      const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
      keyLight.position.set(-30, 70, 90);
      this.previewScene.add(keyLight);
      this.previewCamera = new THREE.PerspectiveCamera(32, 1, 0.1, 400);
      this.previewCamera.position.set(0, 35, 145);
      this.previewCamera.lookAt(0, 27, 0);
    }
    if (this.previewRoot) {
      this.previewScene.remove(this.previewRoot);
      this.disposeAvatarMaterials(this.previewRoot);
    }
    const avatar = SkeletonUtils.clone(template.scene);
    avatar.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(avatar);
    const size = bounds.getSize(new THREE.Vector3());
    const scale = 54 / Math.max(size.y, 0.001);
    avatar.scale.setScalar(scale);
    avatar.position.set(
      -((bounds.min.x + bounds.max.x) / 2) * scale,
      -bounds.min.y * scale,
      -((bounds.min.z + bounds.max.z) / 2) * scale
    );
    this.applyCharacterColors(avatar, character);
    this.previewRoot = new THREE.Group();
    this.previewRoot.add(avatar);
    this.previewScene.add(this.previewRoot);

    const idle = this.modelClip(template.animations, 'idle');
    if (idle) {
      const mixer = new THREE.AnimationMixer(avatar);
      mixer.clipAction(idle).play();
      mixer.update(0.35);
    }
    this.previewRenderer.render(this.previewScene, this.previewCamera);
    for (const target of targets) {
      const context = target.getContext('2d');
      context.clearRect(0, 0, target.width, target.height);
      context.drawImage(this.previewRenderer.domElement, 0, 0, target.width, target.height);
    }
    return true;
  }

  render(players, view, now) {
    if (view.zoomLevel !== this.zoomLevel || view.panX !== this.panX || view.panY !== this.panY) {
      this.zoomLevel = view.zoomLevel;
      this.panX = view.panX;
      this.panY = view.panY;
      this.updateCamera();
    }
    const delta = this.lastRenderAt ? Math.min((now - this.lastRenderAt) / 1000, 0.1) : 0;
    this.lastRenderAt = now;
    const visible = new Set(players.map((player) => player.id));
    for (const [id, record] of this.players) {
      if (visible.has(id)) continue;
      this.scene.remove(record.root);
      this.players.delete(id);
    }
    for (const player of players) {
      if (!player.id) continue;
      let record = this.players.get(player.id);
      if (!record) {
        record = this.createPlayerRecord(player);
        this.players.set(player.id, record);
      }
      this.updatePlayer(player, record, delta, now);
    }
    this.updateDoors(players, view.roomLocks || {}, delta);
    this.renderer.render(this.scene, this.camera);
  }
}
