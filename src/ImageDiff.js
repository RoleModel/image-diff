export default class ImageDiff {
  constructor() {
    this._glContext = null
    this._program = null
    this._diffCanvas = null
    this._positionBuffer = null
    this._texCoordBuffer = null
  }

  _initWebGL(width, height) {
    if (!this._diffCanvas || this._diffCanvas.width !== width || this._diffCanvas.height !== height) {
      this._diffCanvas = document.createElement('canvas')
      this._diffCanvas.width = width
      this._diffCanvas.height = height
      this._glContext = this._diffCanvas.getContext('webgl', { premultipliedAlpha: false })

      if (!this._glContext) {
        console.warn('WebGL not available, falling back to simple overlay')
        return null
      }

      this._setupWebGLProgram()
    }
    return this._glContext
  }

  _setupWebGLProgram() {
    const gl = this._glContext

    const vertexShaderSource = `
      attribute vec2 a_position;
      attribute vec2 a_texCoord;
      varying vec2 v_texCoord;

      void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
        v_texCoord = a_texCoord;
        }
        `

    const fragmentShaderSource = `
      precision mediump float;
      uniform sampler2D u_image1;
      uniform sampler2D u_image2;
      uniform float u_threshold;
      uniform float u_alpha;
      uniform vec3 u_diffColor;
      varying vec2 v_texCoord;

      void main() {
        vec4 color1 = texture2D(u_image1, v_texCoord);
        vec4 color2 = texture2D(u_image2, v_texCoord);

        // Calculate YIQ color difference (perceptual)
        float y1 = color1.r * 0.29889531 + color1.g * 0.58662247 + color1.b * 0.11448223;
        float y2 = color2.r * 0.29889531 + color2.g * 0.58662247 + color2.b * 0.11448223;
        float i1 = color1.r * 0.59597799 - color1.g * 0.27417610 - color1.b * 0.32180189;
        float i2 = color2.r * 0.59597799 - color2.g * 0.27417610 - color2.b * 0.32180189;
        float q1 = color1.r * 0.21147017 - color1.g * 0.52261711 + color1.b * 0.31114694;
        float q2 = color2.r * 0.21147017 - color2.g * 0.52261711 + color2.b * 0.31114694;

        float dy = y1 - y2;
        float di = i1 - i2;
        float dq = q1 - q2;

        float delta = sqrt(dy * dy + di * di + dq * dq);
        float alphaDiff = abs(color1.a - color2.a);

        // Check if difference exceeds threshold
        if (delta > u_threshold || alphaDiff > u_threshold) {
          // Highlight differences with custom color
          gl_FragColor = vec4(u_diffColor, 1.0);
          } else {
            // Show original color from image1 with alpha blending
          gl_FragColor = vec4(color1.rgb, color1.a * u_alpha);
          }
          }
          `

    const vertexShader = this._createShader(gl, gl.VERTEX_SHADER, vertexShaderSource)
    const fragmentShader = this._createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource)

    this._program = gl.createProgram()
    gl.attachShader(this._program, vertexShader)
    gl.attachShader(this._program, fragmentShader)
    gl.linkProgram(this._program)

    if (!gl.getProgramParameter(this._program, gl.LINK_STATUS)) {
      console.error('WebGL program link error:', gl.getProgramInfoLog(this._program))
      return
    }

    // Set up quad geometry
    const positions = new Float32Array([
      -1, -1, 1, -1, -1, 1,
      -1, 1, 1, -1, 1, 1,
    ])

    const texCoords = new Float32Array([
      0, 1, 1, 1, 0, 0,
      0, 0, 1, 1, 1, 0,
    ])

    this._positionBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, this._positionBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW)

    this._texCoordBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, this._texCoordBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW)
  }

  _createShader(gl, type, source) {
    const shader = gl.createShader(type)
    gl.shaderSource(shader, source)
    gl.compileShader(shader)

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('WebGL shader compile error:', gl.getShaderInfoLog(shader))
      gl.deleteShader(shader)
      return null
    }

    return shader
  }

  _setupAttribute(gl, name, buffer, size) {
    const location = gl.getAttribLocation(this._program, name)
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.enableVertexAttribArray(location)
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0)
  }

  _setupUniforms(gl) {
    gl.uniform1i(gl.getUniformLocation(this._program, 'u_image1'), 0)
    gl.uniform1i(gl.getUniformLocation(this._program, 'u_image2'), 1)
    gl.uniform1f(gl.getUniformLocation(this._program, 'u_threshold'), 0.2)
    gl.uniform1f(gl.getUniformLocation(this._program, 'u_alpha'), this.model().overlayOpacity() ?? 1.0)
    gl.uniform3f(gl.getUniformLocation(this._program, 'u_diffColor'), this._diffColor.r, this._diffColor.g, this._diffColor.b)
  }

  _createTexture(gl, canvas) {
    const texture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas)
    return texture
  }

  _create2DContext(width, height) {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    return canvas.getContext('2d')
  }

  _drawToContext(context, figure, transform, options) {
    context.resetTransform()
    context.clearRect(0, 0, context.canvas.width, context.canvas.height)
    context.setTransform(transform)
    figure.draw(context, { ...options, opacity: 1 })
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {Figure} backgroundFigure
   * @param {Figure} overlayFigure
   * @param {Object} options
   * @param {number} [options.overlayOpacity=1.0]
   * @param {Object} [options.diffColor={r:1,g:0,b:0}] - RGB color for highlighting differences (values between 0 and 1)
   * @param {number} [options.diffThreshold=0.2] - Threshold for detecting differences (0 to 1)
   * @param {number} [options.backgroundAlpha=1.0] - Opacity for the background image (0 to 1)
   * @returns {void}
  */

  perform(context, backgroundFigure, overlayFigure, options = {}) {
    const { width, height } = context.canvas
    const transform = context.getTransform()

    this.activePageContext ??= this._create2DContext(width, height)
    this.overlayPageContext ??= this._create2DContext(width, height)

    // Draw both images to temporary canvases
    this._drawToContext(this.activePageContext, backgroundFigure, transform, options)
    this._drawToContext(this.overlayPageContext, overlayFigure, transform, options)

    const gl = this._initWebGL(width, height)

    if (!gl) {
      // Fallback to simple overlay if WebGL unavailable
      this._drawOverlay(context, options)
      return
    }

    gl.useProgram(this._program)

    // Create textures from the canvas images
    const texture1 = this._createTexture(gl, this.activePageContext.canvas)
    const texture2 = this._createTexture(gl, this.overlayPageContext.canvas)

    // Set up vertex attributes
    this._setupAttribute(gl, 'a_position', this._positionBuffer, 2)
    this._setupAttribute(gl, 'a_texCoord', this._texCoordBuffer, 2)

    // Set up uniforms
    this._setupUniforms(gl)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, texture1)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, texture2)

    // Render the diff
    gl.viewport(0, 0, width, height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.drawArrays(gl.TRIANGLES, 0, 6)

    // Copy result to main canvas
    context.save()
    context.resetTransform()
    context.drawImage(this._diffCanvas, 0, 0)
    context.restore()

    // Clean up textures
    gl.deleteTexture(texture1)
    gl.deleteTexture(texture2)
  }
}
