'use strict';

const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const files = [
  ['three/build/three.module.js', 'vendor/three/build/three.module.js'],
  ['three/build/three.core.js', 'vendor/three/build/three.core.js'],
  ['three/examples/jsm/loaders/FBXLoader.js', 'vendor/three/examples/jsm/loaders/FBXLoader.js'],
  ['three/examples/jsm/loaders/GLTFLoader.js', 'vendor/three/examples/jsm/loaders/GLTFLoader.js'],
  ['three/examples/jsm/utils/BufferGeometryUtils.js', 'vendor/three/examples/jsm/utils/BufferGeometryUtils.js'],
  ['three/examples/jsm/utils/SkeletonUtils.js', 'vendor/three/examples/jsm/utils/SkeletonUtils.js'],
  ['three/examples/jsm/libs/fflate.module.js', 'vendor/three/examples/jsm/libs/fflate.module.js'],
  ['three/examples/jsm/curves/NURBSCurve.js', 'vendor/three/examples/jsm/curves/NURBSCurve.js'],
  ['three/examples/jsm/curves/NURBSUtils.js', 'vendor/three/examples/jsm/curves/NURBSUtils.js'],
  ['socket.io/client-dist/socket.io.js', 'socket.io.js']
];

for (const [source, destination] of files) {
  const sourcePath = path.join(projectRoot, 'node_modules', source);
  const destinationPath = path.join(projectRoot, 'public', destination);
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.copyFileSync(sourcePath, destinationPath);
}
