export default class ImageDiff {
  #glContext = null
  #program = null
  #diffCanvas = null
  #positionBuffer = null
  #texCoordBuffer = null
  #backgroundTexture = null
  #overlayTexture = null
  #vertexShader = null
  #fragmentShader = null

  /**
   * @param {TexImageSource} backgroundSource
   * @param {TexImageSource} overlaySource
  */
  constructor(backgroundSource, overlaySource) {
    this.backgroundSource = backgroundSource
    this.overlaySource = overlaySource
  }

  #initWebGL(width, height) {
    if (!this.#diffCanvas) {
      this.#diffCanvas = new OffscreenCanvas(width, height)
      this.#glContext = this.#diffCanvas.getContext('webgl', { premultipliedAlpha: false })

      if (!this.#glContext) {
        console.warn('WebGL not available, falling back to simple overlay')
        return null
      }

      this.#setupWebGLProgram()
    }

    if (this.#diffCanvas.width !== width || this.#diffCanvas.height !== height) {
      this.#diffCanvas.width = width
      this.#diffCanvas.height = height
      this.#glContext.viewport(0, 0, width, height)
    }

    return this.#glContext
  }

  #setupWebGLProgram() {
    const gl = this.#glContext

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
      uniform vec3 u_additionColor;
      uniform vec3 u_deletionColor;
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
          // Determine if this is an addition or deletion
          float brightness1 = (y1 + color1.a) / 2.0;
          float brightness2 = (y2 + color2.a) / 2.0;
          
          if (brightness2 > brightness1) {
            // Addition: overlay has content, background doesn't
            gl_FragColor = vec4(u_additionColor, 1.0);
          } else {
            // Deletion: background has content, overlay doesn't
            // Only show if overlay alpha is high enough, otherwise hide
            if (u_alpha > 0.5) {
              gl_FragColor = vec4(u_deletionColor, 1.0);
            } else {
              // Hide deletions when overlay is hidden
              gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
            }
          }
        } else {
          // Blend overlay on top of background - alpha only affects overlay
          // Preserve background alpha, blend overlay based on u_alpha
          float overlayFactor = color2.a * u_alpha;
          vec3 blended = mix(color1.rgb, color2.rgb, overlayFactor);
          float finalAlpha = max(color1.a, overlayFactor);
          gl_FragColor = vec4(blended, finalAlpha);
        }
      }
      `

    this.#vertexShader = this.#createShader(gl, gl.VERTEX_SHADER, vertexShaderSource)
    this.#fragmentShader = this.#createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource)

    this.#program = gl.createProgram()
    gl.attachShader(this.#program, this.#vertexShader)
    gl.attachShader(this.#program, this.#fragmentShader)
    gl.linkProgram(this.#program)

    if (!gl.getProgramParameter(this.#program, gl.LINK_STATUS)) {
      console.error('WebGL program link error:', gl.getProgramInfoLog(this.#program))
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

    this.#positionBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, this.#positionBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW)

    this.#texCoordBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, this.#texCoordBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW)
  }

  #createShader(gl, type, source) {
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

  #setupAttribute(gl, name, buffer, size) {
    const location = gl.getAttribLocation(this.#program, name)
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.enableVertexAttribArray(location)
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0)
  }

  #setupUniforms(gl, options = {}) {
    const {
      diffThreshold = 0.2,
      backgroundAlpha = 1.0,
      additionColor = { r: 1, g: 0, b: 0 },
      deletionColor = { r: 1, g: 1, b: 0 }
    } = options

    gl.uniform1i(gl.getUniformLocation(this.#program, 'u_image1'), 0)
    gl.uniform1i(gl.getUniformLocation(this.#program, 'u_image2'), 1)
    gl.uniform1f(gl.getUniformLocation(this.#program, 'u_threshold'), diffThreshold)
    gl.uniform1f(gl.getUniformLocation(this.#program, 'u_alpha'), backgroundAlpha)
    gl.uniform3f(gl.getUniformLocation(this.#program, 'u_additionColor'), additionColor.r, additionColor.g, additionColor.b)
    gl.uniform3f(gl.getUniformLocation(this.#program, 'u_deletionColor'), deletionColor.r, deletionColor.g, deletionColor.b)
  }

  /**
   *
   * @param {WebGLRenderingContext} gl
   * @param {Canvas} canvas
   * @returns
   */

  #createTexture(gl, canvas) {
    const texture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas)
    return texture
  }

  /**
   * @param {Object} options
   * @param {Object} [options.additionColor={r:1,g:0,b:0}] - RGB color for highlighting additions (values between 0 and 1)
   * @param {Object} [options.deletionColor={r:1,g:1,b:0}] - RGB color for highlighting deletions (values between 0 and 1)
   * @param {number} [options.diffThreshold=0.2] - Threshold for detecting differences (0 to 1)
   * @param {number} [options.backgroundAlpha=1.0] - Opacity for the overlay image (0 to 1, does not affect background)
   * @returns {OffscreenCanvas} - Canvas with the diff result
  */
  update(options) {
    const width = Math.max(this.backgroundSource.width, this.overlaySource.width)
    const height = Math.max(this.backgroundSource.height, this.overlaySource.height)

    const gl = this.#initWebGL(width, height)

    gl.useProgram(this.#program)

    // Create textures from the canvas images
    this.#backgroundTexture ??= this.#createTexture(gl, this.backgroundSource)
    this.#overlayTexture ??= this.#createTexture(gl, this.overlaySource)

    gl.bindTexture(gl.TEXTURE_2D, this.#backgroundTexture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.backgroundSource)

    gl.bindTexture(gl.TEXTURE_2D, this.#overlayTexture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.overlaySource)

    // Set up vertex attributes
    this.#setupAttribute(gl, 'a_position', this.#positionBuffer, 2)
    this.#setupAttribute(gl, 'a_texCoord', this.#texCoordBuffer, 2)

    // Set up uniforms
    this.#setupUniforms(gl, options)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.#backgroundTexture)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.#overlayTexture)

    // Render the diff
    gl.viewport(0, 0, width, height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.drawArrays(gl.TRIANGLES, 0, 6)

    return this.#diffCanvas
  }

  dispose() {
    const gl = this.#glContext
    if (!gl) return

    // Clean up textures
    gl.deleteTexture(this.#backgroundTexture)
    gl.deleteTexture(this.#overlayTexture)
    // Clean up program
    gl.deleteProgram(this.#program)
    // Clean up buffers
    gl.deleteBuffer(this.#positionBuffer)
    gl.deleteBuffer(this.#texCoordBuffer)
    // Clean up shaders
    gl.deleteShader(this.#vertexShader)
    gl.deleteShader(this.#fragmentShader)
    // Clear the canvas
    this.#diffCanvas.width = 0
    this.#diffCanvas.height = 0
    gl.viewport(0, 0, 0, 0)
    // Reset references
    this.#glContext = null
    this.#program = null
    this.#diffCanvas = null
    this.#positionBuffer = null
    this.#texCoordBuffer = null
  }
}
