
// wrap a function so it only runs 100ms after the last call
// pass true to force immediate evaluation
function debounce(func) {
  var timeout;
  return function(force) {
    var obj = this;
    function delayed() {
      func.apply(obj);
      timeout = null;
    }
    if(timeout)
      clearTimeout(timeout);
    if(force)
      delayed();
    else
      timeout = setTimeout(delayed, 100);
  };
}

// clamp a value with inclusive lower and upper bounds
function clamp(i, lowerBound, upperBound) {
  if(i < lowerBound)
    return lowerBound;
  if(i > upperBound)
    return upperBound;
  return i;
}

function Terminal() {
  var canvas = document.getElementById("terminal");
  var ctx = canvas.getContext("2d");
  var buffer = document.createElement("canvas");
  var bufferCtx = buffer.getContext("2d");

  var charWidth = 10;
  var charHeight = 20;

  var numCols = 0;
  var numRows = 0;

  var scrollTop = 0;
  var scrollBottom = 0;

  this.setSize = function(cols, rows) {
    numCols = cols;
    numRows = rows;
    scrollTop = 0;
    scrollBottom = rows;
    canvas.width = charWidth * cols;
    canvas.height = charHeight * rows;
    buffer.width = charWidth * cols;
    buffer.height = charHeight * rows;
  }

  this.setSize(80,  24);

  var sequenceEnd = /[a-zA-Z@]/;

  /**********************************************
   * Keyboard mappings
   **********************************************/
  var mappings = {
      8: "\u0008",     // backspace
      9: "\u0009",     // tab
     27: "\u001b[~",   // escape
     33: "\u001b[5~",  // page up
     34: "\u001b[6~",  // page down
     35: "\u001b[4~",  // end
     36: "\u001b[1~",  // home
     46: "\u001b[3~",  // delete
    112: "\u001bOP",   // f1
    113: "\u001bOQ",   // f2
    114: "\u001bOR",   // f3
    115: "\u001bOS",   // f4
    116: "\u001b[15~", // f5
    117: "\u001b[17~", // f6
    118: "\u001b[18~", // f7
    119: "\u001b[19~", // f8
    120: "\u001b[20~", // f9
    121: "\u001b[21~", // f10
    122: "\u001b[23~", // f11
    123: "\u001b[24~"  // f12
  }

  function setApplicationCursorKeys(b) {
    if(b) {
      mappings[37] = "\u001bOD"; // left
      mappings[38] = "\u001bOA"; // up
      mappings[39] = "\u001bOC"; // right
      mappings[40] = "\u001bOB"; // down
    }
    else {
      mappings[37] = "\u001b[D"; // left
      mappings[38] = "\u001b[A"; // up
      mappings[39] = "\u001b[C"; // right
      mappings[40] = "\u001b[B"; // down
    }
  }

  setApplicationCursorKeys(false);

  /**********************************************
   * Colors
   **********************************************/
  // 0-15
  var colors = [
    "#000000", // regular 8 color
    "#AA0000", 
    "#00AA00", 
    "#00AA00",
    "#0000AA",
    "#AA00AA",
    "#00AAAA",
    "#AAAAAA",
    "#00AAAA",
    "#FF5555", // bright 8 color
    "#55FF55",
    "#FFFF55",
    "#5555FF",
    "#FF55FF",
    "#55FFFF",
    "#FFFFFF"
    ];

  function toHex(i) {
    var s = i.toString(16);
    while(s.length < 2) s = "0" + s;
    return s;
  }

  // 16-231
  for(var red = 0; red < 6; red++) {
    for(var green = 0; green < 6; green++) {
      for(var blue = 0; blue < 6; blue++) {
        var color = "#" +
          toHex(red ? (red * 40 + 55) : 0) +
          toHex(green ? (green * 40 + 55) : 0) +
          toHex(blue ? (blue * 40 + 55) : 0);
        colors.push(color);
      }
    }
  }

  // 232-255
  for(var gray = 0; gray < 24; gray++) {
    var b = toHex(gray * 10 + 8)
    var level = ("#" + b + b + b).toString(16);
    colors.push(level);
  }

  /**********************************************
   * Terminal state
   **********************************************/
  var curCol = 0;
  var curRow = 0;
  var lazyScrollCount = 0;

  // Set by SM and DECSET
  var modes = {
    25: true // Show cursor on by default
  };

  // Set by SGR
  var displayAttribs = {
    bright: false,
    underscore: false,
    blink: false,
    hidden: false,
    foregroundColor: colors[7],
    backgroundColor: colors[0]
  };

  // Used by DECSET 1049 to store original screen and cursor position
  var originalScreen = null;
  var originalCurRow = 0;
  var originalCurCol = 0;


  function inScrollingRegion() {
    return curRow >= scrollTop && curRow < scrollBottom;
  }

  /**********************************************
   * Rendering
   **********************************************/
  var cursorBacking;

  function translateRow(r) {
    if(r >= scrollTop && r < scrollBottom)
      r = (r - scrollTop + lazyScrollCount) % (scrollBottom - scrollTop) + scrollTop;
    return r;
  }

  var lazyScroll = debounce(function() {
    if(lazyScrollCount != 0) {
      bufferCtx.drawImage(canvas, 0, 0);
      var regionStart = scrollTop * charHeight;
      var firstChunkHeight = lazyScrollCount * charHeight;
      var secondChunkHeight = (scrollBottom - scrollTop - lazyScrollCount) * charHeight;
      ctx.drawImage(buffer,
        0, // sx
        regionStart, // sy
        canvas.width, // sw
        firstChunkHeight, // sh
        0, // dx
        regionStart + secondChunkHeight, // dy
        canvas.width, // dw
        firstChunkHeight); // dh
      ctx.drawImage(buffer,
        0, // sx
        regionStart + firstChunkHeight, // sy
        canvas.width, // sw
        secondChunkHeight, // sh
        0, // dx
        regionStart, // dy
        canvas.width, // dw
        secondChunkHeight); // dh
      lazyScrollCount = 0;
    }
  });

  function scroll() {
    while(curRow >= scrollBottom) {
      lazyScrollCount = (lazyScrollCount + 1) % (scrollBottom - scrollTop);
      var r = translateRow(scrollBottom - 1);
      ctx.fillStyle = displayAttribs.backgroundColor;
      ctx.fillRect(0, r * charHeight, canvas.width, charHeight);
      curRow--;
      lazyScroll();
    }
  }

  function hideCursor(text, textIndex) {
    if(!modes[25])
      return;
    var r = translateRow(curRow);
    if(cursorBacking) {
      ctx.putImageData(cursorBacking, curCol * charWidth, r * charHeight);
      cursorBacking = null;
    }
  }

  function showCursor() {
    if(!modes[25])
      return;
    var r = translateRow(curRow);
    if(!cursorBacking)
      cursorBacking = ctx.getImageData(curCol * charWidth, r * charHeight, charWidth, charHeight);
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = "white";
    ctx.fillRect(curCol * charWidth, r * charHeight, charWidth, charHeight);
    ctx.globalAlpha = 1.0;
  }

  function move(r1, c1, r2, c2, rn, cn) {
    lazyScroll(true);
    var width = (c2 - c1) * charWidth;
    var height = (r2 - r1) * charHeight;
    ctx.drawImage(canvas, c1 * charWidth, r1 * charHeight, width, height, cn * charWidth, rn * charHeight, width, height);
  }

  function clear(r1, c1, r2, c2) {
    lazyScroll(true);
    ctx.fillStyle = displayAttribs.backgroundColor;
    ctx.fillRect(c1 * charWidth, r1 * charHeight, (c2 - c1) * charWidth, (r2 - r1) * charHeight);
  }

  function render(ch) {
    var r = translateRow(curRow);
    ctx.fillStyle = displayAttribs.backgroundColor;
    ctx.fillRect(curCol * charWidth, r * charHeight, charWidth, charHeight);
    ctx.fillStyle = displayAttribs.foregroundColor;
    ctx.fillText(ch, curCol * charWidth + 3, (r + 1) * charHeight - 4);
  }

  /**********************************************
   * Escape sequences
   **********************************************/
  function csi(command) {
    var type = command[command.length - 1];
    var args = command.substr(0, command.length - 1);
//    if(type != "m" && type != "H" && type != "A" && type != "B" && type != "C" && type != "D" && type != "h" && type != "l")
//      console.log(type);
    if(type == "@") { // ICH -- Insert Character
      if(!inScrollingRegion()) return;
      var amount = 1;
      if(args.length != 0) {
        amount = parseInt(args);
        if(isNaN(amount)) return;
      }
      if(amount > numCols - curCol)
        amount = numCols - curCol;
      move(curRow, curCol, curRow + 1, numCols, curRow, curCol + amount);
      clear(curRow, curCol, curRow + 1, curCol + amount);
    }
    else if(type == "m") { // SGR
      var attribs = [0];
      if(args.length != 0) {
        attribs = args.split(';');
        for(attribNum in attribs) {
          attribs[attribNum] = parseInt(attribs[attribNum]);
          if(isNaN(attribs[attribNum])) return;
        }
      }
      for(var attribNum = 0; attribNum < attribs.length; attribNum++) {
        switch(attribs[attribNum]) {
          case 0:
            displayAttribs.bright = false;
            displayAttribs.underscore = false;
            displayAttribs.blink = false;
            displayAttribs.hidden = false;
            displayAttribs.foregroundColor = colors[7]
            displayAttribs.backgroundColor = colors[0];
            break;
          case 1:
            displayAttribs.bright = true;
            break;
          case 2:
            displayAttribs.bright = false;
            break;
          case 4:
            displayAttribs.underscore = true;
            break;
          case 5:
            displayAttribs.blink = true;
            break;
          case 6:
            displayAttribs.reverse = true;
            break;
          case 7:
            displayAttribs.hidden = true;
            break;
          case 30: case 31: case 32: case 33: case 34: case 35: case 36: case 37:
            var colorNum = attribs[attribNum] - 30;
            if(displayAttribs.bright) colorNum += 8;
            displayAttribs.foregroundColor = colors[colorNum];
            break;
          case 38:
            var five = attribs[++attribNum];
            if(five != 5) {
              console.log("five is " + five);
              return;
            }
            var colorNum = attribs[++attribNum];
            if(colorNum < 0 || colorNum > 255) {
              console.log("bad foreground color " + colorNum);
              return;
            }
            displayAttribs.foregroundColor = colors[colorNum];
            break;
          case 39:
            displayAttribs.foregroundColor = colors[7];
            break;
          case 40: case 41: case 42: case 43: case 44: case 45: case 46: case 47:
            var colorNum = attribs[attribNum] - 40;
            if(displayAttribs.bright) colorNum += 8;
            displayAttribs.backgroundColor = colors[colorNum];
            break;
          case 48:
            var five = attribs[++attribNum];
            if(five != 5) {
              console.log("five is " + five);
              return;
            }
            var colorNum = attribs[++attribNum];
            if(colorNum < 0 || colorNum > 255) {
              console.log("bad background color " + colorNum);
              return;
            }
            displayAttribs.backgroundColor = colors[colorNum];
            break;
          case 49:
            displayAttribs.backgroundColor = colors[0];
            break;
          case 90: case 91: case 92: case 93: case 94: case 95: case 96: case 97:
            var colorNum = attribs[attribNum] - 90;
            if(displayAttribs.bright) colorNum += 8;
            displayAttribs.foregroundColor = colors[colorNum];
            break;
          case 100: case 101: case 42: case 103: case 104: case 105: case 106: case 107:
            var colorNum = attribs[attribNum] - 40;
            if(displayAttribs.bright) colorNum += 8;
            displayAttribs.backgroundColor = colors[colorNum];
            break;
          default:
            console.log("Unhandled display attribute " + attribs[attribNum]);
            break;
        }
      }
    }
    else if(type == "K") {
      if(args[0] == "?") { // DECSEL
        console.log("Unhandled DECSEL");
      }
      else { // EL -- Erase in Line
        var mode = 0;
        if(args.length != 0) {
          mode = parseInt(args);
          if(isNaN(mode)) return;
        }
        ctx.fillStyle = displayAttribs.backgroundColor;
        if(mode == 0)  // clear right
          clear(curRow, curCol, curRow + 1, numCols);
        else if(mode == 1)  // clear left
          clear(curRow, 0, curRow + 1, curCol + 1);
        else if(mode == 2) // clear whole line
          clear(curRow, curCol, curRow + 1, numCols);
      }
    }
    else if(type == "P") { // DCH -- Delete Character
      var amount = 1;
      if(args.length != 0) {
        amount = parseInt(args);
        if(isNaN(amount))
          return;
      }
      if(amount > numCols - curCol)
        amount = numCols - curCol;
      move(curRow, curCol + amount, curRow + 1, numCols, curRow, curCol);
      clear(curRow, numCols - amount, curRow + 1, numCols);
    }
    else if(type == "A") { // CUU
      var amount = 1;
      if(args.length != 0) {
        amount = parseInt(args);
        if(isNaN(amount)) return;
      }
      curRow = clamp(curRow - amount, 0, numRows - 1);
    }
    else if(type == "B") { // CUD
      var amount = 1;
      if(args.length != 0) {
        amount = parseInt(args);
        if(isNaN(amount)) return;
      }
      curRow = clamp(curRow + amount, 0, numRows - 1);
    }
    else if(type == "C") { // CUF
      var amount = 1;
      if(args.length != 0) {
        amount = parseInt(args);
        if(isNaN(amount)) return;
      }
      curCol = clamp(curCol + amount, 0, numCols - 1);
    }
    else if(type == "D") { // CUB
      var amount = 1;
      if(args.length != 0) {
        amount = parseInt(args);
        if(isNaN(amount)) return;
      }
      curCol = clamp(curCol - amount, 0, numCols - 1);
    }
    else if(type == "H") { // CUP
      var coords = [1, 1];
      if(args.length != 0) {
        coords = args.split(";");
        if(coords.length != 2) return;
        for(coordNum in coords) {
          coords[coordNum] = parseInt(coords[coordNum]);
          if(isNaN(coords[coordNum])) return;
        }
      }
      curRow = clamp(coords[0], 1, numRows) - 1;
      curCol = clamp(coords[1], 1, numCols) - 1;
    }
    else if(type == "J") { // ED
      var mode = 0;
      if(args.length != 0) {
        mode = parseInt(args);
        if(isNaN(mode)) return;
      }
      if(mode == 0) { // below
        clear(curRow, curCol, curRow + 1, numCols); // current line
        if(curRow + 1 < numRows)
          clear(curRow + 1, 0, numRows, numCols); // everything below
      }
      else if(mode == 1) { // above
        if(curRow > 0)
          clear(0, 0, curRow, numCols); // everything above
        clear(curRow, 0, curRow + 1, numCols); // current line
      }
      else if(mode == 2) { // all
        clear(0, 0, numRows, numCols);
      }
      else {
        console.log("Unknown ED mode " +mode);
      }
    }
    else if(type == "L") { // IL -- Insert Line
      var amount = 1;
      if(args.length != 0) {
        amount = parseInt(args);
        if(isNaN(amount)) return;
      }
      move(curRow, 0, scrollBottom - amount, numCols, curRow + amount, 0);
      clear(curRow, 0, curRow + amount, numCols);
    }
    else if(type == "M") { // DL -- Delete Line
      var amount = 1;
      if(args.length != 0) {
        amount = parseInt(args);
        if(isNaN(amount)) return;
      }
      move(curRow + amount, 0, scrollBottom, numCols, curRow, 0);
      clear(scrollBottom - amount, 0, scrollBottom, numCols);
    }
    else if(type == "c") { // DA -- Device attributes
      if(args[0] == ">") {
        console.log("Secondary device attributes");
        socket.send("\u001b[0;95;9c");
      }
      else {
        console.log("Primary device attributes not supported");
      }
    }
    else if(type == "d") { // VPA -- Vertical Position Absolute
      var col = 1;
      if(args.length != 0) {
        col = parseInt(args);
        if(isNaN(col)) return;
      }
      curCol = clamp(col, 1, numCols) - 1;
    }
    else if(type == "h") { // DECSET, SM
      var isDecset = (args[0] == "?");
      if(isDecset) args = args.substr(1);
      var modeNum = parseInt(args);
      if(isNaN(modeNum)) return;
      modes[modeNum] = true;
      if(modeNum == 1) {
        console.log("Set application cursor keys");
        setApplicationCursorKeys(true)
      }
      else if(modeNum == 25) {
        console.log("Show cursor");
      }
      else if(modeNum == 34) {
        console.log("Set right to left cursor");
      }
      else if(modeNum == 1000) {
        console.log("Enable mouse");
      }
      else if(modeNum == 1049) {
        console.log("Use alternate screen buffer");
        originalScreen = ctx.getImageData(0, 0, canvas.width, canvas.height);
        originalCurRow = curRow;
        originalCurCol = curCol;
      }
      else {
        console.log("SET " + modeNum);
      }
    }
    else if(type == "l") { // DECRST, RM
      var isDecset = (args[0] == "?");
      if(isDecset) args = args.substr(1);
      var modeNum = parseInt(args);
      if(isNaN(modeNum)) return;
      delete modes[modeNum];
      if(modeNum == 1) {
        console.log("Unset application cursor keys");
        setApplicationCursorKeys(false);
      }
      else if(modeNum == 25) {
        console.log("Hide cursor");
      }
      else if(modeNum == 34) {
        console.log("Unset right to left cursor");
      }
      else if(modeNum == 1000) {
        console.log("Disable mouse");
      }
      else if(modeNum == 1049) {
        console.log("Use original screen buffer");
        if(originalScreen)
          ctx.putImageData(originalScreen, 0, 0);
        curRow = originalCurRow;
        curCol = originalCurCol;
        originalScreen = null;
        originalCurRow = 0;
        originalCurCol = 0;
      }
      else {
        console.log("RST " + modeNum);
      }
    }
    else if(type == "r") { // DECSTBM
      var lines = [];
      if(args.length != 0) {
        lines = args.split(";");
        for(lineNum in lines) {
          lines[lineNum] = parseInt(lines[lineNum]);
          if(isNaN(lines[lineNum])) return;
        }
      }
      lazyScroll(true); // Important!
      curCol = 0;
      curRow = 0;
      if(lines.length < 1)
        scrollTop = 0;
      else
        scrollTop = lines[0] - 1;
      if(lines.length < 2)
        scrollBottom = numRows;
      else
        scrollBottom = lines[1];
      //console.log("Scroll region is now " + scrollTop + ", " + scrollBottom);
    }
    else {
      console.log("Unhandled CSI escape sequence: " + command);
    }
  }

  function osc(command) {
    var args = command.split(";", 2);
    if(args[0] == "0") {
      if(args.length == 2)
        document.title = args[1];
    }
    else {
      console.log("unhandled osc");
    }
  }

  function escape_(text, textIndex) {

    //console.log(text);

    if(text[textIndex] == "=") {
      //console.log("Application keypad");
      return textIndex + 1;
    }

    if(text[textIndex] == ">") {
      //console.log("Normal keypad");
      return textIndex + 1;
    }

    if(text[textIndex] == "M") {
      console.log("Reverse Index");
      return textIndex + 1;
    }

    if(text[textIndex] == "]") {
      textIndex++;
      var commandLen = text.indexOf("\u0007", textIndex) - textIndex;
      if(commandLen < 0) {
        console.log("osc sequence unterminated");
        return textIndex;
      }
      osc(text.substr(textIndex, commandLen));
      return textIndex + commandLen;
    }

    if(text[textIndex] == "[") {
      textIndex++;
      var commandLen = text.substr(textIndex).search(sequenceEnd);
      if(commandLen < 0) {
        console.log("csi sequence unterminated");
        return textIndex;
      }
      commandLen++;
      csi(text.substr(textIndex, commandLen));
      return textIndex + commandLen;
    }

    console.log("Unhandled escape sequence: " + text.substr(textIndex));
    return textIndex;
  }

  this.write = function(text) {
    hideCursor();
    ctx.font = "12px Courier New";

    var i = 0;
    while(i < text.length) {
      var ch = text[i++];
      if(ch == "\u001B") { // escape
        i = escape_(text, i);
      }
      else if(ch == "\r") { // carriage return
        curCol = 0;
      }
      else if(ch == "\n") { // newline
        curCol = 0;
        curRow++;
        scroll();
      }
      else if(ch == "\u0007") { // bell
        // Change window title?
      }
      else if(ch == "\u0008") { // backspace
        if(curCol > 0)
          curCol--;
      }
      else {
        var code = ch.charCodeAt(0);
        if(code < 32 || code > 126) {
          console.log("Unknown character code: " + code);
        }
        else {
          render(ch);

          curCol++;
          if(curCol == numCols) {
            curCol = 0;
            curRow++;
            scroll();
          }
        }
      }
    }
    showCursor();
  } // write()

  function sendMouseEvent(e) {
    if(!modes[1000])
      return false;

    var button = 0;

    if(e.button == 0)
      button += 0;
    else if(e.button == 1)
      button += 1;
    else if(e.button == 2)
      button += 2;
    if(e.type == "mouseup")
      button += 3;
    if(e.shiftKey)
      button += 4;
    if(e.altKey)
      button += 8;
    if(e.ctrlKey)
      button += 16;
    // Mouse buttons 3 and 4? How can I trap them?

    var row = Math.floor(e.offsetY / charHeight) + 33;
    var col = Math.floor(e.offsetX / charWidth) + 33;

    socket.send("\u001b[M" + String.fromCharCode(button) + String.fromCharCode(col) + String.fromCharCode(row));

    return true;
  }

  this.onKeyDown = function(e) {
    var trans = mappings[e.keyCode];
    if(trans) {
      socket.send(trans);
      return false;
    }
    if(e.ctrlKey && e.keyCode >= 65 && e.keyCode <= 90) { // ctrl-alpha
      socket.send(String.fromCharCode(e.keyCode - 64));
      return false;
    }
    return true;
  };

  canvas.onmousedown = function(e) { return sendMouseEvent(e); }
  canvas.onmouseup = function(e) { return sendMouseEvent(e); }
}

var term = new Terminal();

var socket = new WebSocket("wss://risk:3000/terminal");
socket.onopen = function() {
  term.write("\u001B[2J"); // ED 2 (clear everything)
};
socket.onmessage = function(e) {
  term.write(e.data);
};

document.onkeypress = function(e) {
  socket.send(String.fromCharCode(e.keyCode));
  return true;
}

// We need to catch some keys onkeydown so the browser doesn't handle them

document.onkeydown = function(e) { return term.onKeyDown(e); };

