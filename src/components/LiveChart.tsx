import React, { useEffect, useState } from 'react';
import {
  ComposedChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from 'recharts';

const CandlestickShape = (props: any) => {
  const { x, y, width, height, payload } = props;
  const { open, high, low, close } = payload;
  
  const isUp = close >= open;
  const color = isUp ? '#26a69a' : '#ef5350';

  const totalRange = high - low;
  if (totalRange === 0) {
    return <rect x={x} y={y} width={width} height={2} fill={color} />;
  }

  const pxPerVal = height / totalRange;
  
  const yHigh = y;
  const yLow = y + height;
  const yOpen = y + (high - open) * pxPerVal;
  const yClose = y + (high - close) * pxPerVal;
  
  const bodyTop = Math.min(yOpen, yClose);
  const bodyBottom = Math.max(yOpen, yClose);
  const bodyHeight = Math.max(2, bodyBottom - bodyTop);

  const centerX = x + width / 2;

  return (
    <g>
      <line x1={centerX} y1={yHigh} x2={centerX} y2={yLow} stroke={color} strokeWidth={2} />
      <rect x={x} y={bodyTop} width={width} height={bodyHeight} fill={color} stroke={color} />
    </g>
  );
};

export function LiveChart({ livePrice, instrument }: { livePrice?: number, instrument: string }) {
  const [data, setData] = useState<any[]>([]);

  useEffect(() => {
    fetch(`/api/candles?instrument=${instrument}&timeframe=1&limit=60`)
      .then(r => r.json())
      .then(candles => {
        if (!Array.isArray(candles)) return;
        
        const formatted = candles.reverse().map(c => ({
          time: new Date(c.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          range: [c.low, c.high]
        }));
        
        setData(formatted);
      })
      .catch(console.error);
  }, [instrument]);

  useEffect(() => {
    if (livePrice && data.length > 0) {
      setData(prev => {
        const newData = [...prev];
        const last = { ...newData[newData.length - 1] };
        
        last.close = livePrice;
        if (livePrice > last.high) last.high = livePrice;
        if (livePrice < last.low) last.low = livePrice;
        last.range = [last.low, last.high];
        
        newData[newData.length - 1] = last;
        return newData;
      });
    }
  }, [livePrice]);

  if (data.length === 0) {
    return <div className="h-full flex items-center justify-center text-gray-500">Loading chart data...</div>;
  }

  const min = Math.min(...data.map(d => d.low));
  const max = Math.max(...data.map(d => d.high));
  const padding = (max - min) * 0.1;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#2d3748" vertical={false} />
        <XAxis 
          dataKey="time" 
          stroke="#718096" 
          tick={{ fill: '#718096', fontSize: 12 }} 
          minTickGap={30}
        />
        <YAxis 
          domain={[min - padding, max + padding]} 
          stroke="#718096" 
          tick={{ fill: '#718096', fontSize: 12 }}
          tickFormatter={(val) => val.toFixed(0)}
          orientation="right"
        />
        <Tooltip 
          contentStyle={{ backgroundColor: '#1a202c', borderColor: '#2d3748', color: '#e2e8f0' }}
          labelStyle={{ color: '#a0aec0', marginBottom: '5px' }}
          formatter={(value: any, name: string, props: any) => {
            if (name === 'range') return null; // Hide the array range
            return value;
          }}
          labelFormatter={(label) => `Time: ${label}`}
        />
        <Bar 
          dataKey="range" 
          shape={<CandlestickShape />} 
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
