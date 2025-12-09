# Image Diff

Real-time image diffing in the browser, powered by WebGL.

## Installing

```shell
npm install @rolemodel/image-diff
```

or

```shell
yarn add @rolemodel/image-diff
```

## Usage

```javascript
import ImageDiff from "@rolemodel/image-diff"

const originalImage = document.getElementById('base-image')
const newImage = document.getElementById('new-image')
const outputCanvas = document.getElementById('output-canvas')
const outputContext = outputCanvas.getContext('2d')
const imageDiff = new ImageDiff(originalImage, newImage)

const result = imageDiff.update({
  diffColor: { r: 1, g: 0, b: 0 },
  diffThreshold: 0.2,
  backgroundAlpha: 1.0
})

// result is an offscreen canvas
outputContext.drawImage(result, 0, 0)

imageDiff.dispose()
```

Calling `update()` again will re-render the diff. Make sure to call `dispose()` to clean up WebGL resources.

## Acknowledgments

**image-diff** is [MIT-licensed](LICENSE), open-source software from [RoleModel Software][rms]. It was initially based on [pixelmatch](https://github.com/mapbox/pixelmatch), using a similar algorithm ported to WebGL.

[RoleModel Software][rms] is a world-class, collaborative software development team dedicated to delivering the highest quality custom web and mobile software solutions while cultivating a work environment where community, family, learning, and mentoring flourish.

[rms]: https://rolemodelsoftware.com/
