require 'rack/websocket'
require 'pty'

class TerminalPump < EventMachine::Connection
  def initialize app
    super
    @app = app
    puts("#{object_id}#initialize")
  end
  def notify_readable
    #puts("#{object_id}#notify_readable")
    data = @io.readpartial(4096)
    @app.send_data(data)
  end
  def unbind
    puts("#{object_id}#unbind")
    @io.close()
  end
end

class TerminalApp < Rack::WebSocket::Application
  def on_open(env)
    puts "#{object_id} Client connected"
    @rio, @wio, @pid = PTY.spawn('env', 'TERM=xterm-256color', '/bin/bash', '-l') #PTY.spawn('/usr/bin/sudo', '/bin/login')
    @term = EM.watch(@rio, TerminalPump, self)
    @term.notify_readable = true
  end
  def on_close(env)
    puts "#{object_id} Client disconnected"
    @term.detach()
    @wio.close()
    Process.kill("INT", @pid)
  end
  def on_message(env, data)
    #puts "#{object_id} Received message: " + data.inspect
    @wio.write(data)
  end
end

use Rack::CommonLogger

map '/' do
  run Rack::File.new(File.expand_path(File.dirname(__FILE__)) + '/static')
end

map '/terminal' do
  run TerminalApp.new
end

